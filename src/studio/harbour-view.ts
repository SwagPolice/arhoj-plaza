import * as THREE from 'three';

const SAIL = 8; // seconds to glide out to the horizon, or back
const MOORED = new THREE.Vector3(0.72, -1.12, 1.45); // the boat's spot by the pier, in the harbour's own frame
const OUT = 28; // how far out it sails (along the pier, out to sea)

/**
 * The harbour's boat and crate, following the save: the boat glides out to sea when a trip starts and back when
 * it ends (or is simply away / home after loading), and the crate shows while a haul waits.
 * The island can be rebuilt at any time, so the boat and crate are looked up afresh each frame.
 */
export class HarbourView {
  private away = 0; // 0 = moored, 1 = gone over the horizon
  private settled = false; // first frame after loading: jump straight to where it should be

  update(dt: number, t: number, harbour: THREE.Object3D | undefined, atSea: boolean, haul: boolean) {
    const boat = harbour?.getObjectByName('boat');
    const crate = harbour?.getObjectByName('crate');
    if (crate) crate.visible = haul;
    if (!boat) return;
    const target = atSea ? 1 : 0;
    if (!this.settled) {
      this.away = target;
      this.settled = true;
    } else this.away += Math.sign(target - this.away) * Math.min(Math.abs(target - this.away), dt / SAIL);
    const k = this.away * this.away * (3 - 2 * this.away); // ease in and out
    boat.position.copy(MOORED).setZ(MOORED.z + k * OUT);
    boat.position.y = MOORED.y + Math.sin(t * 1.3) * 0.015; // gently afloat
    boat.rotation.z = Math.sin(t * 0.9) * 0.03;
    boat.visible = this.away < 0.98;
  }

  /** After a reset (e.g. a new save): settle again without animating. */
  reset() {
    this.settled = false;
  }
}
