import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mode } from '../mode';
import { addLights } from '../scene/stage';
import { buildIsland } from '../scene/island';
import { buildCharacter, disposeObject } from '../character/build';
import { randomRecipe, type CharacterRecipe } from '../character/recipe';
import { loadAll, removeAll, saveOne } from '../storage';
import { button, el } from '../ui/dom';
import { Agent, randomSpot, stepAgents, type World } from './behaviour';
import { Bubbles } from './bubbles';

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
    this.hemi = addLights(this.scene, 10, new THREE.Vector3(6, 12, 8)).hemi;

    const island = buildIsland();
    this.scene.add(island.group);
    this.world = island.world;

    this.camera.position.set(0, 11.5, 16.5);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 26;
    this.controls.minPolarAngle = 0.4;
    this.controls.maxPolarAngle = 1.2;
    this.controls.enabled = false;

    const bubbleLayer = el('div', 'bubble-layer');
    this.bubbles = new Bubbles(bubbleLayer, this.camera);

    const empty = this.empty;
    empty.append(
      el('h2', '', 'Nobody lives here yet'),
      el('p', 'muted', 'Make a character, or invite a few random friends to get things going.'),
      button('Invite 6 random friends', 'btn primary', () => this.invite(6)),
      button('Make a character', 'btn', () => this.hooks.create()),
    );

    const tools = el('div', 'plaza-tools');
    tools.append(
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
    this.active = false;
    this.controls.enabled = false;
    this.layer.style.display = 'none';
    this.card.style.display = 'none';
    this.bubbles.clear();
  }

  update(dt: number, t: number) {
    this.controls.update();
    stepAgents(this.agents, this.world, dt, t, (a, text, delay) => this.say(a, text, delay));
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
    this.empty.style.display = list.length ? 'none' : '';
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
