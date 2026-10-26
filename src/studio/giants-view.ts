import * as THREE from 'three';
import { disposeObject } from '../character/build';
import { buildGiant } from './giants-model';
import { GIANT_STAY, type GiantKind } from './giants';

const WATER = -1.1;
const RISE = 4; // seconds to rise from the sea, or sink back

/**
 * A giant of the sea in the scene: it rises out at sea behind the island (left of the lighthouse, clear of the
 * merchant's usual spots), stays a while, and sinks back. The ghost rises up to its eyes and looks at you, the
 * glass mushroom bobs like a jellyfish as it drifts, and the serpent glides past in humps before diving.
 */
export class GiantView {
  kind: GiantKind | null = null;
  private root: THREE.Group | null = null;
  private height = 0;
  private t = 0;
  private spot = new THREE.Vector3();
  private along = new THREE.Vector3(); // the serpent's way, along the island
  private sinking = false;

  constructor(private scene: THREE.Scene) {}

  get out() {
    return !!this.root;
  }

  /**
   * Rise beside an island this size, somewhere it fits on screen: out at sea behind the island, on the left or
   * straight behind (clear of the lighthouse on the right), as big as it can be there and still be seen whole.
   */
  show(kind: GiantKind, radius: number, camera: THREE.Camera, ceiling = 0.8) {
    this.hide();
    const { root, height } = buildGiant(kind);
    const spot = this.findSpot(kind, root, height, radius, camera, ceiling);
    root.scale.multiplyScalar(spot.fit);
    this.kind = kind;
    this.root = root;
    this.height = height * spot.fit;
    this.t = 0;
    this.sinking = false;
    this.spot.set(Math.sin(spot.angle) * spot.distance, 0, Math.cos(spot.angle) * spot.distance);
    this.along.set(Math.cos(spot.angle), 0, -Math.sin(spot.angle)); // across your view
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    this.scene.add(root);
    this.place(0);
  }

  /** Sink back now (it's been tapped, or its time is up). */
  sink() {
    if (this.root && !this.sinking) {
      this.sinking = true;
      this.t = Math.max(this.t, RISE + GIANT_STAY);
    }
  }

  /**
   * Where it fits: tries spots behind the island (and smaller sizes if it must), picking at random among the best.
   * `ceiling` is how high on screen it may reach (in -1 to 1 from the bottom): below the HUD.
   */
  private findSpot(kind: GiantKind, root: THREE.Group, height: number, radius: number, camera: THREE.Camera, ceiling: number) {
    camera.updateMatrixWorld();
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const wide = kind === 'serpent' ? size.x * 0.55 : Math.max(size.x, size.z) / 2; // the serpent glides: half of it at a time
    const shown = height * VISIBLE[kind] + (kind === 'mushroom' ? 0.35 : 0);
    const at = new THREE.Vector3();
    for (const fit of [1, 0.85, 0.7, 0.6, 0.5]) {
      const good: { angle: number; distance: number; fit: number }[] = [];
      for (let deg = -105; deg >= -180; deg -= 10) { // the back-left round to straight behind (the lighthouse is back-right)
        const angle = (deg * Math.PI) / 180;
        for (const extra of [1.8, 3, 4.5]) {
          const distance = radius + extra + wide * fit * 0.5;
          const fits = [-1, 1].every((side) =>
            [WATER, WATER + shown * fit].every((y) => {
              at.set(Math.sin(angle) * distance, y, Math.cos(angle) * distance);
              at.addScaledVector(new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)), side * wide * fit);
              const v = at.project(camera);
              return Math.abs(v.x) < 0.94 && v.y < ceiling; // on screen, below the HUD
            }),
          );
          if (fits) good.push({ angle, distance, fit });
        }
      }
      if (good.length) return good[Math.floor(Math.random() * good.length)];
    }
    return { angle: (-150 * Math.PI) / 180, distance: radius + 3, fit: 0.5 };
  }

  hide() {
    if (!this.root) return;
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.root = null;
    this.kind = null;
  }

  hit(raycaster: THREE.Raycaster) {
    return !!this.root && raycaster.intersectObject(this.root, true).length > 0;
  }

  /** The top of it, in the world, for a bubble. */
  get top() {
    return this.root ? new THREE.Vector3(this.root.position.x, this.root.position.y + this.height + 0.4, this.root.position.z) : null;
  }

  get object() {
    return this.root;
  }

  update(dt: number, camera: THREE.Camera) {
    if (!this.root) return;
    this.t += dt;
    if (this.t >= RISE * 2 + GIANT_STAY) return this.hide();
    this.place(this.t, camera);
  }

  /** Where it is `t` seconds after rising began: up out of the water, a while there, then back down. */
  private place(t: number, camera?: THREE.Camera) {
    const root = this.root!;
    const up = t < RISE ? ease(t / RISE) : t < RISE + GIANT_STAY ? 1 : 1 - ease((t - RISE - GIANT_STAY) / RISE);
    const k = this.kind;
    if (k === 'serpent') {
      // Gliding along the whole time, rising from below at the start and diving at the end.
      const glide = (t / (RISE * 2 + GIANT_STAY) - 0.5) * 5; // a little way along, so it stays in view
      root.position.copy(this.spot).addScaledVector(this.along, glide);
      root.position.y = WATER - this.height * (1 - up);
      root.rotation.set(0, Math.atan2(-this.along.z, this.along.x), 0);
      const body = root.children[0];
      body.children.forEach((part, i) => {
        if (part.name === 'hump') part.position.y = Math.sin(t * 1.6 - i * 0.9) * 0.08;
        if (part.name === 'head') part.rotation.z = Math.sin(t * 0.8) * 0.08;
      });
      return;
    }
    const show = VISIBLE[k!]; // how much of it rises out of the water
    root.position.copy(this.spot);
    if (k === 'mushroom') root.position.addScaledVector(this.along, Math.sin(t * 0.15) * 1.2); // drifting slowly
    const bob = k === 'mushroom' ? Math.sin(t * 1.3) * 0.35 : Math.sin(t * 0.7) * 0.08;
    root.position.y = WATER - this.height + this.height * show * up + bob * up;
    if (camera) root.rotation.y = Math.atan2(camera.position.x - root.position.x, camera.position.z - root.position.z); // looking at you
  }
}

const ease = (x: number) => x * x * (3 - 2 * x);
/** How much of each rises out of the water: the ghost up to its eyes, the serpent all its humps, most of the mushroom. */
const VISIBLE: Record<GiantKind, number> = { ghost: 0.55, serpent: 1, mushroom: 0.75 };
