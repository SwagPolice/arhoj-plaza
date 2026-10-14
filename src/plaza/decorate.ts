import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { decorHeight, type BuiltIsland } from '../scene/island';
import {
  canPlace, canTurn, defaultLayout, footprint, ISLAND_SIZE, MAX_DECOR, maxSizeHere, minRadius, nearestFreeSpot, placeNew, SIZES, turned,
  type Decor, type DecorKind, type IslandLayout,
} from '../scene/layout';
import { button, el } from '../ui/dom';

/** What Decorate mode needs from the plaza. */
export type DecorateHost = {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  ui: HTMLElement;
  layout(): IslandLayout;
  island(): BuiltIsland;
  /** Save the layout and rebuild the island from it. */
  commit(layout: IslandLayout): void;
  /** The Done button. */
  done(): void;
};

type Drag = {
  id: string;
  obj: THREE.Object3D;
  start: THREE.Vector3;
  offset: THREE.Vector3;
  pointerId: number;
  downX: number;
  downY: number;
  moved: boolean;
  valid: boolean;
  landing: { x: number; z: number } | null; // where it will go if released now
};

const ADD: { kind: DecorKind; label: string }[] = [
  { kind: 'tree', label: '🌲 Tree' },
  { kind: 'pond', label: '💧 Pond' },
  { kind: 'rock', label: '🪨 Rock' },
  { kind: 'mushroom', label: '🍄 Mushroom' },
];
const NAMES: Record<DecorKind, string> = { tree: 'tree', pond: 'pond', rock: 'rock', mushroom: 'mushroom' };
type Look = 'selected' | 'invalid' | null;
const RED = new THREE.Color('#e0452f');
const GLOW = new THREE.Color('#5c4620');

/**
 * Decorate mode: resize the island, add things, drag them around, and turn, resize or remove them.
 * Dragging an object never turns the camera; dragging empty ground still does.
 */
export class Decorator {
  active = false;
  private bar = el('div', 'decor-bar');
  private hint = el('div', 'decor-hint');
  private size = el('input');
  /** The little toolbar above the selected object: turn, size, remove. */
  private tools = el('div', 'decor-tools');
  private toolSize = el('input');
  private turnButtons: HTMLButtonElement[] = [];
  private selected: string | null = null;
  private drag: Drag | null = null;
  /** An object sliding to where it ends up; `then` runs when it gets there. */
  private slide: { obj: THREE.Object3D; to: THREE.Vector3; then?: () => void } | null = null;
  /** A faint circle on the ground showing where a held object will land. */
  private marker = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 48),
    new THREE.MeshBasicMaterial({ color: '#2b2420', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  private ease: { pos: THREE.Vector3; target: THREE.Vector3; time: number } | null = null;
  private savedView: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hintTimer = 0;
  private v = new THREE.Vector3();

  constructor(private host: DecorateHost) {
    this.size.type = 'range';
    this.size.min = String(ISLAND_SIZE.min);
    this.size.max = String(ISLAND_SIZE.max);
    this.size.step = '0.1';
    this.size.addEventListener('input', () => this.resize(parseFloat(this.size.value)));
    const sizeRow = el('label', 'decor-row');
    sizeRow.append(el('span', '', 'Island size'), this.size);

    const addRow = el('div', 'decor-row decor-add');
    for (const a of ADD) addRow.append(button(a.label, 'btn', () => this.add(a.kind)));

    const endRow = el('div', 'decor-row');
    endRow.append(
      button('Reset island', 'btn', () => {
        if (!confirm('Put the island back the way it started?')) return;
        this.select(null);
        this.host.commit(defaultLayout());
        this.syncSize();
      }),
      button('Done', 'btn primary', () => this.host.done()),
    );

    this.toolSize.type = 'range';
    this.toolSize.step = '0.01';
    this.toolSize.title = 'Size';
    this.toolSize.addEventListener('input', () => this.resizeSelected(parseFloat(this.toolSize.value)));
    const tool = (label: string, title: string, run: () => void) => {
      const b = button(label, 'btn decor-tool', run);
      b.title = title;
      return b;
    };
    this.turnButtons = [
      tool('↺', 'Turn left', () => this.turnSelected(Math.PI / 6)),
      tool('↻', 'Turn right', () => this.turnSelected(-Math.PI / 6)),
    ];
    this.tools.append(
      ...this.turnButtons,
      el('span', 'decor-tools-label', 'Size'),
      this.toolSize,
      tool('✕', 'Remove', () => this.removeSelected()),
    );

    this.bar.append(sizeRow, el('div', 'muted decor-tip', 'Drag things to move them · tap one to turn, resize or remove it'), addRow, this.hint, endRow);
    this.bar.style.display = this.tools.style.display = 'none';
    host.ui.append(this.bar, this.tools);

    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;

    const c = host.canvas;
    // Capture phase: runs before the camera controls, so grabbing an object can stop the camera from turning.
    c.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => this.cancelDrag());
  }

  enter() {
    this.active = true;
    this.bar.style.display = '';
    this.syncSize();
    // A higher, more top-down view that fits the whole island.
    const { camera, controls } = this.host;
    this.savedView = { pos: camera.position.clone(), target: controls.target.clone() };
    // Aim a little in front of the middle, so the island sits above the bar.
    const r = this.host.layout().radius;
    const target = new THREE.Vector3(0, 0, r * 0.3);
    // Far enough to fit the island's height, and its width too on narrow (phone) screens.
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const d = Math.max(r * 3.5, (r * 1.15) / halfWidth);
    this.ease = { pos: target.clone().add(new THREE.Vector3(0, d * Math.cos(0.45), d * Math.sin(0.45))), target, time: 0.8 };
  }

  leave() {
    this.cancelDrag();
    this.select(null);
    this.active = false;
    this.bar.style.display = 'none';
    if (this.savedView) this.ease = { ...this.savedView, time: 0.8 };
    this.savedView = null;
  }

  /** Every frame: camera easing, objects sliding back, and keeping the Remove button above its object. */
  update(dt: number, width: number, height: number) {
    const k = 1 - Math.exp(-dt * 7);
    if (this.ease) {
      this.host.camera.position.lerp(this.ease.pos, k);
      this.host.controls.target.lerp(this.ease.target, k);
      if ((this.ease.time -= dt) <= 0) this.ease = null;
    }
    if (this.slide) {
      const s = this.slide;
      s.obj.position.lerp(s.to, Math.min(1, dt * 14));
      if (s.obj.position.distanceTo(s.to) < 0.01) {
        s.obj.position.copy(s.to);
        this.slide = null;
        s.then?.();
      }
    }
    const item = this.item(this.selected);
    const obj = this.selected ? this.host.island().decor.get(this.selected) : null;
    if (!item || !obj || this.drag) {
      this.tools.style.display = 'none';
      return;
    }
    obj.getWorldPosition(this.v);
    this.v.y += decorHeight(item) + 0.25;
    this.v.project(this.host.camera);
    this.tools.style.display = this.v.z < 1 ? '' : 'none';
    // Above the object, but never off the side of the screen.
    const half = this.tools.offsetWidth / 2;
    const x = Math.min(width - half - 8, Math.max(half + 8, ((this.v.x + 1) / 2) * width));
    const y = Math.max(this.tools.offsetHeight + 8, ((1 - this.v.y) / 2) * height);
    this.tools.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  /** After the island is rebuilt, re-apply the selection highlight to the new objects. */
  refresh() {
    if (this.selected && !this.item(this.selected)) this.selected = null;
    if (this.selected) tint(this.host.island().decor.get(this.selected), 'selected');
  }

  // ---------- actions ----------

  private add(kind: DecorKind) {
    const layout = this.host.layout();
    const item = placeNew(layout, kind);
    if (!item) {
      this.say(layout.items.length >= MAX_DECOR ? "That's plenty! Remove something first." : `No room left for another ${NAMES[kind]}. Try a bigger island.`);
      return;
    }
    this.host.commit({ ...layout, items: [...layout.items, item] });
    this.select(item.id);
  }

  private removeSelected() {
    if (!this.selected) return;
    const layout = this.host.layout();
    const id = this.selected;
    this.select(null);
    this.host.commit({ ...layout, items: layout.items.filter((d) => d.id !== id) });
  }

  private turnSelected(delta: number) {
    const item = this.item(this.selected);
    if (!item || !canTurn(item.kind)) return;
    this.update1(item.id, { rot: turned(item.rot, delta) });
  }

  private resizeSelected(value: number) {
    const item = this.item(this.selected);
    if (!item) return;
    const room = maxSizeHere(this.host.layout(), item);
    let size = Math.round(value * 100) / 100;
    if (size > room) {
      size = room;
      this.toolSize.value = String(room);
      this.say('No room to grow here. Move it somewhere roomier first.');
    }
    if (size !== item.size) this.update1(item.id, { size });
  }

  /** Change one object and save. */
  private update1(id: string, patch: Partial<Decor>) {
    const layout = this.host.layout();
    this.host.commit({ ...layout, items: layout.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  private resize(value: number) {
    const layout = this.host.layout();
    const smallest = minRadius(layout);
    let radius = Math.round(value * 10) / 10;
    if (radius < smallest) {
      radius = smallest;
      this.size.value = String(smallest);
      this.say('Move things inward to make the island smaller.');
    }
    if (radius !== layout.radius) this.host.commit({ ...layout, radius });
  }

  private syncSize() {
    this.size.value = String(this.host.layout().radius);
  }

  private select(id: string | null) {
    if (this.selected) tint(this.host.island().decor.get(this.selected), null);
    this.selected = id;
    if (id) tint(this.host.island().decor.get(id), 'selected');
    const item = this.item(id);
    if (item) {
      // Turning only shows up for things that aren't round from above.
      for (const b of this.turnButtons) b.style.display = canTurn(item.kind) ? '' : 'none';
      this.toolSize.min = String(SIZES[item.kind].min);
      this.toolSize.max = String(SIZES[item.kind].max);
      this.toolSize.value = String(item.size);
    }
  }

  private say(text: string) {
    this.hint.textContent = text;
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => (this.hint.textContent = ''), 3500);
  }

  private item(id: string | null): Decor | undefined {
    return id ? this.host.layout().items.find((d) => d.id === id) : undefined;
  }

  // ---------- dragging ----------

  private aim(e: PointerEvent) {
    const rect = this.host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.host.camera);
  }

  private groundPoint(e: PointerEvent) {
    this.aim(e);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  private onDown(e: PointerEvent) {
    if (!this.active || this.drag || this.slide) return;
    this.aim(e);
    const hit = this.raycaster.intersectObjects([...this.host.island().decor.values()], true)[0];
    let obj: THREE.Object3D | null = hit?.object ?? null;
    while (obj && !obj.userData.decorId) obj = obj.parent;
    if (!obj) {
      this.select(null); // empty ground: deselect, and let the camera turn as usual
      return;
    }
    e.stopImmediatePropagation(); // the camera controls never see this press
    this.host.canvas.setPointerCapture(e.pointerId);
    const point = this.groundPoint(e) ?? obj.position.clone();
    this.drag = {
      id: obj.userData.decorId,
      obj,
      start: obj.position.clone(),
      offset: point.sub(obj.position).setY(0),
      pointerId: e.pointerId,
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
      valid: true,
      landing: null,
    };
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.downX, e.clientY - d.downY) < 6) return;
    if (!d.moved) this.select(d.id);
    d.moved = true;
    const point = this.groundPoint(e);
    const item = this.item(d.id);
    if (!point || !item) return;
    let x = point.x - d.offset.x;
    let z = point.z - d.offset.z;
    // Keep it over the island, even if the pointer wanders off the edge.
    const max = this.host.layout().radius - footprint(item) - 0.2;
    const dist = Math.hypot(x, z);
    if (dist > max && dist > 0) [x, z] = [(x / dist) * Math.max(max, 0), (z / dist) * Math.max(max, 0)];
    d.obj.position.set(x, 0.15, z); // lifted a little while held
    d.valid = canPlace(this.host.layout(), item, x, z);
    tint(d.obj, d.valid ? 'selected' : 'invalid');
    // Over a blocked spot: show where it would land instead.
    d.landing = d.valid ? { x, z } : nearestFreeSpot(this.host.layout(), item, x, z);
    this.showMarker(d.valid ? null : d.landing, footprint(item));
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (this.host.canvas.hasPointerCapture(e.pointerId)) this.host.canvas.releasePointerCapture(e.pointerId);
    if (!d.moved) {
      this.select(this.selected === d.id ? null : d.id); // a tap toggles the selection
      return;
    }
    this.showMarker(null, 0);
    tint(d.obj, 'selected');
    // Released on a blocked spot: hop over to the nearest free one (or back home if there's none at all).
    const spot = d.landing;
    if (!spot) {
      this.slide = { obj: d.obj, to: d.start };
      return;
    }
    const place = () => {
      const layout = this.host.layout();
      this.host.commit({ ...layout, items: layout.items.map((i) => (i.id === d.id ? { ...i, x: spot.x, z: spot.z } : i)) });
    };
    if (d.valid) place();
    else this.slide = { obj: d.obj, to: new THREE.Vector3(spot.x, 0, spot.z), then: place };
  }

  private showMarker(spot: { x: number; z: number } | null, radius: number) {
    const m = this.marker;
    if (!m.parent) this.host.island().group.parent?.add(m);
    m.visible = !!spot;
    if (!spot) return;
    m.position.set(spot.x, 0.03, spot.z);
    m.scale.setScalar(Math.max(radius, 0.25));
  }

  private cancelDrag() {
    this.showMarker(null, 0);
    if (!this.drag) return;
    this.drag.obj.position.copy(this.drag.start);
    tint(this.drag.obj, this.selected === this.drag.id ? 'selected' : null);
    this.drag = null;
  }
}

/** Show an object as selected (a warm glow) or as "can't go here" (turned red); null shows it normally. */
function tint(obj: THREE.Object3D | undefined, look: Look) {
  obj?.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !('emissive' in o.material)) return;
    const m = o.material as THREE.MeshPhysicalMaterial;
    const base: THREE.Color = (m.userData.baseColour ??= m.color.clone());
    m.color.copy(base);
    if (look === 'invalid') m.color.lerp(RED, 0.65);
    m.emissive.copy(look === 'selected' ? GLOW : new THREE.Color(0x000000));
  });
}
