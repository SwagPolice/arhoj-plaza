import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mode } from '../mode';
import { addLights } from './stage';
import { buildIsland, type BuiltIsland } from './island';
import type { IslandLayout } from './layout';
import { buildCharacter, disposeObject } from '../character/build';
import type { CharacterRecipe } from '../character/recipe';
import { el } from '../ui/dom';
import { Agent, randomSpot, stepAgents, type World } from '../plaza/behaviour';
import { Bubbles } from '../plaza/bubbles';

const MORNING = new THREE.Color('#f7e6d6');
const NOON = new THREE.Color('#eef0e4');
const SKY_MORNING = new THREE.Color('#ffe9d6');
const SKY_NOON = new THREE.Color('#f4f7ff');

/**
 * An island with characters living on it: the scene, camera, wandering, bubbles and taps.
 * The Creative plaza and the Studio both build on this; each adds its own tools and rules.
 */
export abstract class IslandView implements Mode {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  protected controls: OrbitControls;
  protected agents: Agent[] = [];
  protected world: World;
  protected layout: IslandLayout;
  protected island: BuiltIsland;
  protected bubbles: Bubbles;
  protected layer = el('div', 'layer');
  protected raycaster = new THREE.Raycaster();
  protected active = false;
  protected w = 1;
  protected h = 1;
  private signatures = new Map<string, string>();
  private hemi: THREE.HemisphereLight;
  private background = new THREE.Color(MORNING);
  private toastEl = el('div', 'toast plaza-toast');
  private toastTimer = 0;
  private down = { x: 0, y: 0 };

  constructor(protected renderer: THREE.WebGLRenderer, env: THREE.Texture, uiRoot: HTMLElement, layout: IslandLayout) {
    this.scene.background = this.background;
    this.scene.fog = new THREE.Fog(this.background, 30, 70);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    this.hemi = addLights(this.scene, 13, new THREE.Vector3(6, 12, 8)).hemi;

    this.layout = layout;
    this.island = buildIsland(layout, this.wellTints(), this.withFlowers);
    this.scene.add(this.island.group);
    this.world = this.island.world;

    const k = layout.radius / 7.5;
    this.camera.position.set(0, 11.5 * k, 16.5 * k);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.4;
    this.controls.maxPolarAngle = 1.2;
    this.controls.enabled = false;
    this.fitToIsland();

    const bubbleLayer = el('div', 'bubble-layer');
    this.bubbles = new Bubbles(bubbleLayer, this.camera);
    this.layer.append(bubbleLayer, this.toastEl);
    this.layer.style.display = 'none';
    uiRoot.append(this.layer);

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (this.active && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 6) this.onTap(e);
    });
  }

  // ---------- what each kind of island decides for itself ----------

  /** Keep a changed layout (Creative and Studio save to different places). */
  protected abstract saveLayout(layout: IslandLayout): void;
  /** A short tap on the island (not a drag). */
  protected abstract onTap(e: PointerEvent): void;
  /** True while characters should hold still (e.g. decorating). */
  protected get frozen() {
    return false;
  }
  /** True while the camera may zoom out further than usual (e.g. the decorating view). */
  protected get wideView() {
    return false;
  }
  /** Two characters started chatting. */
  protected onChat(_a: Agent, _b: Agent) {}
  /** Every frame, after the characters moved. */
  protected onUpdate(_dt: number, _t: number) {}
  /** After the island was rebuilt from a new layout. */
  protected onLayoutApplied() {}
  /** Scattered flowers on the grass (off in Studio Mode, where they'd look like drops). */
  protected get withFlowers() {
    return true;
  }
  /** Colours for glaze wells' water, by well id (Studio Mode). */
  protected wellTints(): Record<string, string> {
    return {};
  }

  // ---------- Mode ----------

  enter() {
    this.active = true;
    this.controls.enabled = true;
    this.layer.style.display = '';
  }

  leave() {
    this.active = false;
    this.controls.enabled = false;
    this.layer.style.display = 'none';
    this.bubbles.clear();
  }

  update(dt: number, t: number) {
    this.controls.update();
    if (!this.frozen) stepAgents(this.agents, this.world, dt, t, (a, text, delay) => this.say(a, text, delay), (a, b) => this.onChat(a, b));
    this.onUpdate(dt, t);
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
    if (!this.wideView) {
      // Tall screens look down a little more steeply, so the island fills more of the height.
      const offset = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      offset.phi = this.camera.aspect < 0.8 ? 0.7 : Math.atan2(16.5, 11.5);
      offset.radius = this.viewDistance();
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(offset));
    }
    this.fitToIsland();
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 3000);
  }

  // ---------- helpers for subclasses ----------

  /** Add UI on top of the island (below the toast). */
  protected addUI(...els: HTMLElement[]) {
    for (const e of els) this.layer.insertBefore(e, this.toastEl);
  }

  /** How far back the camera stands: the usual distance, or further on narrow screens so the island's width fits. */
  protected viewDistance() {
    const r = this.layout.radius;
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    return Math.max(r * 2.68, (r * 1.05) / halfWidth); // r × 2.68 is the original view on wide screens
  }

  /** Camera zoom limits and fog that suit the island's size (the wide view may zoom out further). */
  protected fitToIsland() {
    const k = this.layout.radius / 7.5;
    this.controls.minDistance = 6 * k;
    const d = this.viewDistance();
    const wide = this.wideView;
    this.controls.maxDistance = wide ? 120 : Math.max(30 * k, d * 1.3);
    // Haze only beyond the island, however far back the camera is.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = wide ? 150 : Math.max(30 * k, d + this.layout.radius);
    fog.far = wide ? 300 : Math.max(70 * k, d + this.layout.radius * 7);
  }

  /** Save a new island layout and rebuild the island from it. */
  protected applyLayout(layout: IslandLayout) {
    this.saveLayout(layout);
    this.layout = layout;
    this.scene.remove(this.island.group);
    disposeObject(this.island.group);
    this.island = buildIsland(layout, this.wellTints(), this.withFlowers);
    this.scene.add(this.island.group);
    this.world = this.island.world;
    this.fitToIsland();
    this.onLayoutApplied();
  }

  /** Anyone whose spot is now taken (or off a smaller island) reappears somewhere free. */
  protected returnToIsland() {
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
      a.path = [];
      placed.push(a);
    }
  }

  /** Bring the characters in line with a list of recipes: add newcomers, rebuild changed ones, remove the rest. */
  protected syncAgents(list: CharacterRecipe[]) {
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
  }

  protected say(a: Agent, text: string, delay = 0) {
    this.bubbles.show(a.built.root, a.built.height + 0.25, text, delay);
  }

  /** Point the raycaster at where the pointer is. */
  protected aim(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  /** The character under the pointer, if any. */
  protected pickAgent(e: PointerEvent): Agent | null {
    this.aim(e);
    const hit = this.raycaster.intersectObjects(this.agents.map((a) => a.built.root), true)[0];
    let obj: THREE.Object3D | null = hit?.object ?? null;
    while (obj && !obj.userData.agentId) obj = obj.parent;
    return (obj && this.agents.find((a) => a.recipe.id === obj!.userData.agentId)) || null;
  }
}
