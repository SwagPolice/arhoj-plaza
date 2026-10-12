import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './editor.css';
import type { Mode } from '../mode';
import { addLights, glaze, PAPER } from '../scene/stage';
import { buildCharacter, disposeObject, type BuiltCharacter } from '../character/build';
import {
  BODIES, EYES, FINISHES, HEIGHT, MOUTHS, PERSONALITIES, TOPPERS, WIDTH,
  defaultRecipe, randomLooks, randomName, type CharacterRecipe,
} from '../character/recipe';
import { GLAZES } from '../character/palette';
import { loadAll, removeOne, saveOne } from '../storage';
import { button, el } from '../ui/dom';

const LABELS: Record<string, string> = {
  cone: 'Cone', mushroom: 'Mushroom', ghost: 'Ghost', bean: 'Bean', bell: 'Bell',
  glossy: 'Glossy', speckled: 'Speckled', drip: 'Drip',
  none: 'None', cap: 'Beret', spots: 'Spots', leaf: 'Sprout', 'tiny-hat': 'Top hat',
  dots: 'Dots', wide: 'Big', closed: 'Happy', sleepy: 'Sleepy',
  smile: 'Smile', o: 'Ooh', cat: 'Cat',
  calm: '🍵 Calm', curious: '🔍 Curious', shy: '🌱 Shy', bouncy: '🎵 Bouncy',
};

export class Editor implements Mode {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private controls: OrbitControls;
  private turntable = new THREE.Group();
  private built: BuiltCharacter | null = null;
  private recipe: CharacterRecipe = defaultRecipe();
  private layer = el('div', 'layer');
  private panel = el('aside', 'panel');
  private savedList = el('div', 'saved-list');
  private toastEl = el('div', 'toast');
  private syncers: (() => void)[] = [];
  private pop = 0;
  private toastTimer = 0;

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture, uiRoot: HTMLElement) {
    this.scene.background = new THREE.Color(PAPER);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
    addLights(this.scene, 2.5, new THREE.Vector3(3, 6, 5));

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.95, 0.2, 64),
      glaze('#e9dfcd', { roughness: 0.5, clearcoat: 0.3 }),
    );
    plinth.position.y = -0.1;
    plinth.castShadow = plinth.receiveShadow = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    this.scene.add(plinth, floor, this.turntable);

    this.camera.position.set(0, 1.5, 6.4);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05;
    this.controls.enabled = false;

    this.buildPanel();
    this.layer.append(this.panel, this.toastEl);
    this.layer.style.display = 'none';
    uiRoot.append(this.layer);
    this.rebuild();
  }

  load(recipe: CharacterRecipe) {
    this.recipe = { ...recipe };
    this.rebuild();
    this.sync();
    this.renderSaved();
  }

  enter() {
    this.layer.style.display = '';
    this.controls.enabled = true;
    this.sync();
    this.renderSaved();
  }

  leave() {
    this.layer.style.display = 'none';
    this.controls.enabled = false;
  }

  update(dt: number, t: number) {
    this.controls.update();
    this.turntable.rotation.y = Math.sin(t * 0.5) * 0.4;
    if (!this.built) return;
    // A little "boing" whenever something changes, plus gentle breathing.
    this.pop = Math.max(0, this.pop - dt * 3.5);
    const boing = Math.sin(this.pop * Math.PI * 2) * this.pop * 0.12;
    const breathe = Math.sin(t * 2) * 0.012;
    this.built.pose.scale.set(1 - boing * 0.5, 1 + boing + breathe, 1 - boing * 0.5);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.zoom = w > 760 ? 1 : 0.75;
    // Shift the character away from the panel (right side on desktop, bottom on phones).
    if (w > 760) this.camera.setViewOffset(w, h, 180, 0, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    this.camera.updateProjectionMatrix();
  }

  private rebuild() {
    if (this.built) {
      this.turntable.remove(this.built.root);
      disposeObject(this.built.root);
    }
    this.built = buildCharacter(this.recipe);
    this.turntable.add(this.built.root);
    this.pop = 1;
  }

  private set<K extends keyof CharacterRecipe>(key: K, value: CharacterRecipe[K]) {
    this.recipe = { ...this.recipe, [key]: value };
    this.rebuild();
    this.sync();
  }

  private sync() {
    for (const s of this.syncers) s();
  }

  // ---------- panel ----------

  private buildPanel() {
    const name = el('input', 'name-input');
    name.maxLength = 18;
    name.placeholder = 'Name';
    name.addEventListener('input', () => (this.recipe = { ...this.recipe, name: name.value }));
    this.syncers.push(() => {
      if (document.activeElement !== name) name.value = this.recipe.name;
    });
    const dice = button('🎲', 'icon-btn', () => {
      this.recipe = { ...this.recipe, name: randomName() };
      this.sync();
    });
    dice.title = 'Random name';
    const nameRow = el('div', 'name-row');
    nameRow.append(name, dice);

    const blush = button('Blush', 'chip', () => this.set('cheeks', !this.recipe.cheeks));
    this.syncers.push(() => blush.classList.toggle('on', this.recipe.cheeks));

    const actions = el('div', 'actions');
    actions.append(
      button('🎲 Surprise me', 'btn', () => {
        this.recipe = randomLooks(this.recipe);
        this.rebuild();
        this.sync();
      }),
      button('New', 'btn', () => this.load(defaultRecipe())),
      button('Save', 'btn primary', () => this.save()),
    );

    this.panel.append(
      nameRow,
      section('Shape', this.chips('body', BODIES)),
      section('Size', this.slider('height', 'Tall', HEIGHT), this.slider('width', 'Wide', WIDTH)),
      section('Glaze', this.swatches('glaze'), this.chips('glazeFinish', FINISHES)),
      section('On top', this.chips('topper', TOPPERS), this.swatches('topperColour')),
      section('Eyes', this.chips('eyes', EYES)),
      section('Mouth', this.chips('mouth', MOUTHS), blush),
      section('Personality', this.chips('personality', PERSONALITIES)),
      actions,
      section('Your characters', this.savedList),
    );
  }

  private chips<K extends keyof CharacterRecipe>(key: K, options: readonly CharacterRecipe[K][]) {
    const wrap = el('div', 'chips');
    for (const v of options) {
      const b = button(LABELS[String(v)] ?? String(v), 'chip', () => this.set(key, v));
      wrap.append(b);
      this.syncers.push(() => b.classList.toggle('on', this.recipe[key] === v));
    }
    return wrap;
  }

  private swatches(key: 'glaze' | 'topperColour') {
    const wrap = el('div', 'swatches');
    for (const g of GLAZES) {
      const b = button('', 'swatch', () => this.set(key, g.hex));
      b.style.background = g.hex;
      b.title = g.name;
      wrap.append(b);
      this.syncers.push(() => b.classList.toggle('on', this.recipe[key].toLowerCase() === g.hex));
    }
    return wrap;
  }

  private slider(key: 'height' | 'width', label: string, range: { min: number; max: number }) {
    const row = el('label', 'slider');
    const input = el('input');
    input.type = 'range';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = '0.01';
    input.addEventListener('input', () => {
      this.recipe = { ...this.recipe, [key]: parseFloat(input.value) };
      this.rebuild();
    });
    this.syncers.push(() => (input.value = String(this.recipe[key])));
    row.append(el('span', '', label), input);
    return row;
  }

  private save() {
    if (!this.recipe.name.trim()) this.recipe = { ...this.recipe, name: randomName() };
    saveOne(this.recipe);
    this.sync();
    this.renderSaved();
    this.toast(`Saved ${this.recipe.name} ✓ They've moved into the plaza.`);
  }

  private renderSaved() {
    const list = loadAll();
    this.savedList.replaceChildren();
    if (!list.length) {
      this.savedList.append(el('p', 'muted', 'Saved characters show up here.'));
      return;
    }
    for (const r of list) {
      const item = el('div', 'saved' + (r.id === this.recipe.id ? ' on' : ''));
      const open = button('', 'saved-open', () => this.load(r));
      const dotEl = el('span', 'saved-dot');
      dotEl.style.background = r.glaze;
      open.append(dotEl, el('span', '', r.name || 'Unnamed'));
      const del = button('×', 'saved-del', () => {
        if (!confirm(`Say goodbye to ${r.name}?`)) return;
        removeOne(r.id);
        this.renderSaved();
      });
      del.title = 'Delete';
      item.append(open, del);
      this.savedList.append(item);
    }
  }

  private toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }
}

function section(title: string, ...children: HTMLElement[]) {
  const s = el('section', 'section');
  s.append(el('h3', '', title), ...children);
  return s;
}
