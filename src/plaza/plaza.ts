import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mode } from '../mode';
import { addLights } from '../scene/stage';
import { buildIsland, type BuiltIsland } from '../scene/island';
import type { IslandLayout } from '../scene/layout';
import { buildCharacter, disposeObject } from '../character/build';
import { randomRecipe, type CharacterRecipe } from '../character/recipe';
import { loadAll, loadIsland, removeAll, saveIsland, saveOne } from '../storage';
import { button, el } from '../ui/dom';
import { Agent, randomSpot, stepAgents, type World } from './behaviour';
import { Bubbles } from './bubbles';
import { Decorator } from './decorate';

const MORNING = new THREE.Color('#f7e6d6');
const NOON = new THREE.Color('#eef0e4');
const SKY_MORNING = new THREE.Color('#ffe9d6');
const SKY_NOON = new THREE.Color('#f4f7ff');
const PERSONALITY_ICON: Record<string, string> = { calm: '🍵', curious: '🔍', shy: '🌱', bouncy: '🎵' };

type Hooks = { edit(recipe: CharacterRecipe): void; create(): void };

export class Plaza implements Mode {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  private controls: OrbitControls;
  private agents: Agent[] = [];
  private signatures = new Map<string, string>();
  private world: World;
  private layout: IslandLayout;
  private island: BuiltIsland;
  private decorator: Decorator;
  private tools = el('div', 'plaza-tools');
  private bubbles: Bubbles;
  private hemi: THREE.HemisphereLight;
  private background = new THREE.Color(MORNING);
  private layer = el('div', 'layer');
  private card = el('div', 'card');
  private empty = el('div', 'empty');
  private raycaster = new THREE.Raycaster();
  private down = { x: 0, y: 0 };
  private active = false;
  private w = 1;
  private h = 1;

  constructor(private renderer: THREE.WebGLRenderer, env: THREE.Texture, uiRoot: HTMLElement, private hooks: Hooks) {
    this.scene.background = this.background;
    this.scene.fog = new THREE.Fog(this.background, 30, 70);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    this.hemi = addLights(this.scene, 13, new THREE.Vector3(6, 12, 8)).hemi;

    this.layout = loadIsland();
    this.island = buildIsland(this.layout);
    this.scene.add(this.island.group);
    this.world = this.island.world;

    const k = this.layout.radius / 7.5;
    this.camera.position.set(0, 11.5 * k, 16.5 * k);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.4;
    this.controls.maxPolarAngle = 1.2;
    this.controls.enabled = false;
    this.fitToIsland();

    this.decorator = new Decorator({
      canvas: renderer.domElement,
      camera: this.camera,
      controls: this.controls,
      ui: this.layer,
      layout: () => this.layout,
      island: () => this.island,
      commit: (layout) => this.applyLayout(layout),
      done: () => this.setDecorating(false),
    });

    const bubbleLayer = el('div', 'bubble-layer');
    this.bubbles = new Bubbles(bubbleLayer, this.camera);

    const empty = this.empty;
    empty.append(
      el('h2', '', 'Nobody lives here yet'),
      el('p', 'muted', 'Make a character, or invite a few random friends to get things going.'),
      button('Invite 6 random friends', 'btn primary', () => this.invite(6)),
      button('Make a character', 'btn', () => this.hooks.create()),
    );

    const tools = this.tools;
    tools.append(
      button('🛠 Decorate', 'btn', () => this.setDecorating(true)),
      button('🧹 Clear plaza', 'btn', () => this.clearAll()),
      button('＋ Random friend', 'btn', () => this.invite(1)),
      button('✏️ Make new', 'btn', () => this.hooks.create()),
    );

    this.card.style.display = 'none';
    this.layer.append(bubbleLayer, this.card, empty, tools);
    this.layer.style.display = 'none';
    uiRoot.append(this.layer);

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (this.active && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 6) this.pick(e);
    });
  }

  enter() {
    this.active = true;
    this.controls.enabled = true;
    this.layer.style.display = '';
    this.sync();
  }

  leave() {
    if (this.decorator.active) this.setDecorating(false);
    this.active = false;
    this.controls.enabled = false;
    this.layer.style.display = 'none';
    this.card.style.display = 'none';
    this.bubbles.clear();
  }

  update(dt: number, t: number) {
    this.controls.update();
    // While decorating, everyone holds still.
    if (!this.decorator.active) stepAgents(this.agents, this.world, dt, t, (a, text, delay) => this.say(a, text, delay));
    this.decorator.update(dt, this.w, this.h);
    this.bubbles.update(this.w, this.h);
    // Slow drift between morning and midday light.
    const k = (Math.sin((t * Math.PI * 2) / 90) + 1) / 2;
    this.background.lerpColors(MORNING, NOON, k);
    (this.scene.fog as THREE.Fog).color.copy(this.background);
    this.hemi.color.lerpColors(SKY_MORNING, SKY_NOON, k);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Frame the whole island for this screen shape (phones need to stand further back).
    if (!this.decorator.active) {
      // Tall screens look down a little more steeply, so the island fills more of the height.
      const offset = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      offset.phi = this.camera.aspect < 0.8 ? 0.7 : Math.atan2(16.5, 11.5);
      offset.radius = this.viewDistance();
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(offset));
    }
    this.fitToIsland();
  }

  /** How far back the camera stands: the usual distance, or further on narrow screens so the island's width fits. */
  private viewDistance() {
    const r = this.layout.radius;
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    return Math.max(r * 2.68, (r * 1.05) / halfWidth); // r × 2.68 is the original view on wide screens
  }

  // ---------- decorating ----------

  private setDecorating(on: boolean) {
    if (on === this.decorator.active) return;
    this.tools.style.display = on ? 'none' : '';
    this.card.style.display = 'none';
    this.bubbles.clear();
    // Characters step off the island while decorating, so anything can go anywhere.
    for (const a of this.agents) a.built.root.visible = !on;
    if (on) {
      this.empty.style.display = 'none';
      this.decorator.enter();
    } else {
      this.decorator.leave();
      this.empty.style.display = this.agents.length ? 'none' : '';
      this.returnToIsland();
    }
    this.fitToIsland();
  }

  /** After decorating: anyone whose spot is now taken (or off a smaller island) reappears somewhere free. */
  private returnToIsland() {
    const placed: Agent[] = [];
    for (const a of this.agents) {
      const blocked =
        a.pos.length() > this.world.radius - a.radius - 0.2 ||
        this.world.obstacles.some((o) => Math.hypot(a.pos.x - o.x, a.pos.y - o.z) < o.r + a.radius);
      if (blocked) a.pos.copy(randomSpot(this.world, a.radius, placed));
      a.state = 'idle';
      a.partner = null;
      a.timer = Math.random();
      a.target.copy(a.pos);
      placed.push(a);
    }
  }

  /** Save a new island layout and rebuild the island from it. */
  private applyLayout(layout: IslandLayout) {
    saveIsland(layout);
    this.layout = layout;
    this.scene.remove(this.island.group);
    disposeObject(this.island.group);
    this.island = buildIsland(layout);
    this.scene.add(this.island.group);
    this.world = this.island.world;
    this.fitToIsland();
    this.decorator.refresh();
  }

  /** Camera zoom limits and fog that suit the island's size. Decorate mode may zoom out further, to fit narrow screens. */
  private fitToIsland() {
    const k = this.layout.radius / 7.5;
    this.controls.minDistance = 6 * k;
    const d = this.viewDistance();
    this.controls.maxDistance = this.decorator?.active ? 120 : Math.max(30 * k, d * 1.3);
    // Haze only beyond the island, however far back the camera is (phones and Decorate stand further away).
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.decorator?.active ? 150 : Math.max(30 * k, d + this.layout.radius);
    fog.far = this.decorator?.active ? 300 : Math.max(70 * k, d + this.layout.radius * 7);
  }

  /** Bring the plaza in line with what's saved: add newcomers, rebuild edited ones, remove deleted ones. */
  private sync() {
    const list = loadAll();
    const ids = new Set(list.map((r) => r.id));
    this.agents = this.agents.filter((a) => {
      if (ids.has(a.recipe.id)) return true;
      this.scene.remove(a.built.root);
      disposeObject(a.built.root);
      this.signatures.delete(a.recipe.id);
      return false;
    });
    for (const r of list) {
      const sig = JSON.stringify(r);
      if (this.signatures.get(r.id) === sig) continue;
      this.signatures.set(r.id, sig);
      const built = buildCharacter(r);
      built.root.userData.agentId = r.id;
      const existing = this.agents.find((a) => a.recipe.id === r.id);
      if (existing) {
        this.scene.remove(existing.built.root);
        disposeObject(existing.built.root);
        existing.recipe = r;
        existing.built = built;
      } else {
        const agent = new Agent(r, built);
        agent.pos.copy(randomSpot(this.world, built.radius, this.agents));
        this.agents.push(agent);
      }
      this.scene.add(built.root);
    }
    this.empty.style.display = list.length || this.decorator.active ? 'none' : '';
  }

  private invite(count: number) {
    for (let i = 0; i < count; i++) saveOne(randomRecipe());
    this.sync();
  }

  private clearAll() {
    const count = this.agents.length;
    if (!count || !confirm(`Say goodbye to all ${count} characters? This can't be undone.`)) return;
    removeAll();
    this.card.style.display = 'none';
    this.bubbles.clear();
    this.sync();
  }

  private say(a: Agent, text: string, delay = 0) {
    this.bubbles.show(a.built.root, a.built.height + 0.25, text, delay);
  }

  private pick(e: PointerEvent) {
    if (this.decorator.active) return; // clicks belong to the decorations
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.agents.map((a) => a.built.root), true)[0];
    let obj: THREE.Object3D | null = hit?.object ?? null;
    while (obj && !obj.userData.agentId) obj = obj.parent;
    const agent = obj && this.agents.find((a) => a.recipe.id === obj!.userData.agentId);
    if (!agent) {
      this.card.style.display = 'none';
      return;
    }
    agent.lookAt(this.camera.position.x, this.camera.position.z, 3);
    this.say(agent, '😊');
    this.showCard(agent.recipe);
  }

  private showCard(r: CharacterRecipe) {
    const actions = el('div', 'card-actions');
    actions.append(
      button('Edit', 'btn primary', () => this.hooks.edit(r)),
      button('Close', 'btn', () => (this.card.style.display = 'none')),
    );
    this.card.replaceChildren(
      el('div', 'card-name', r.name || 'Unnamed'),
      el('div', 'muted', `${PERSONALITY_ICON[r.personality]} ${r.personality} ${r.body}`),
      actions,
    );
    this.card.style.display = '';
  }
}
