import * as THREE from 'three';
import { buildMerchant } from './merchant-model';

const FLY = 6; // seconds to float in from the horizon, or away again
const FAR = new THREE.Vector3(14, 7, -26); // where he comes from, relative to his spot

/**
 * The merchant in the scene: floats in from far away, hovers by the island bobbing gently and turned towards you,
 * and floats off again. Growing (a new step) eases him to his new size.
 */
export class MerchantBalloon {
  readonly root: THREE.Group;
  readonly height: number;
  private spot = new THREE.Vector3();
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; away: boolean } | null = null;
  private scale = 1;
  private targetScale = 1;

  constructor(scene: THREE.Scene) {
    const m = buildMerchant();
    this.root = m.root;
    this.height = m.height;
    this.root.visible = false;
    scene.add(this.root);
  }

  /** True while he's hovering (not flying in or out): the time to tap him. */
  get ready() {
    return this.root.visible && !this.flight;
  }

  /**
   * Where he waits, where the screen has room: beside the island on wide screens,
   * behind it on tall (phone) screens, where the space is above the island.
   */
  setSpot(radius: number, wide: boolean) {
    if (wide) this.spot.set(radius + 1.6, 0.3, 0.4);
    else this.spot.set(radius * 0.35, 0.1, -(radius + 0.6));
    if (this.ready) this.root.position.copy(this.spot);
  }

  /** Already here (after loading or coming back): appear in place. */
  show(scale: number) {
    this.scale = this.targetScale = scale;
    this.root.scale.setScalar(scale);
    this.root.position.copy(this.spot);
    this.root.visible = true;
    this.flight = null;
  }

  arrive(scale: number) {
    this.show(scale);
    const from = this.spot.clone().add(FAR);
    this.root.position.copy(from);
    this.flight = { from, to: this.spot.clone(), t: 0, away: false };
  }

  leave() {
    if (!this.root.visible) return;
    this.flight = { from: this.root.position.clone(), to: this.spot.clone().add(FAR), t: 0, away: true };
  }

  hide() {
    this.root.visible = false;
    this.flight = null;
  }

  grow(scale: number) {
    this.targetScale = scale;
  }

  /** Is he under the pointer? */
  hit(raycaster: THREE.Raycaster) {
    return this.ready && raycaster.intersectObject(this.root, true).length > 0;
  }

  /** Top of his head in the world, for speech bubbles. */
  get top() {
    return this.height * this.scale + 0.2;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    if (!this.root.visible) return;
    const p = this.root.position;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / FLY);
      const k = f.t * f.t * (3 - 2 * f.t); // ease in and out
      p.lerpVectors(f.from, f.to, k);
      if (f.t >= 1) {
        this.flight = null;
        if (f.away) this.root.visible = false;
      }
    } else p.y = this.spot.y + Math.sin(t * 1.1) * 0.08;
    this.scale += (this.targetScale - this.scale) * Math.min(1, dt * 2);
    this.root.scale.setScalar(this.scale);
    this.root.rotation.set(0, Math.atan2(camera.position.x - p.x, camera.position.z - p.z), Math.sin(t * 0.7) * 0.04);
  }
}
