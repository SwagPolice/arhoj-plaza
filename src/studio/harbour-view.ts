import * as THREE from 'three';
import { buildCharacter, disposeObject } from '../character/build';
import type { CharacterRecipe } from '../character/recipe';

const SAIL = 8; // seconds to glide out to the horizon, or back
const OUT = 28; // how far out it sails (along the pier, out to sea)
const SEAT = 0.3; // crew size in the boat (the boat itself is scaled up)

/**
 * The harbour's boat and crate, following the save: the boat glides out to sea with the crew aboard when a trip
 * starts, and back with them when it ends; the crate shows while a haul waits. The crew only step ashore
 * (`onDocked`) once the boat is back at the pier. The island can be rebuilt at any time, so the boat and crate
 * are looked up afresh each frame.
 */
export class HarbourView {
  /** Called when the boat is back at the pier with its crew. */
  onDocked: (() => void) | null = null;
  private away = 0; // 0 = moored, 1 = gone over the horizon
  private settled = false; // first frame after loading: jump straight to where it should be
  private aboard: CharacterRecipe[] = [];
  private seated: { boat: THREE.Object3D; key: string } | null = null;

  /** Characters still on the boat on its way home: not on the island yet. */
  get arriving(): Set<string> {
    return new Set(this.away > 0 ? this.aboard.map((r) => r.id) : []);
  }

  update(dt: number, t: number, harbour: THREE.Object3D | undefined, crew: CharacterRecipe[] | null, haul: boolean) {
    const boat = harbour?.getObjectByName('boat');
    const crate = harbour?.getObjectByName('crate');
    if (crate) crate.visible = haul;
    if (crew) this.aboard = crew;
    const target = crew ? 1 : 0;
    if (!this.settled) {
      this.away = target;
      this.settled = true;
      if (!crew) this.aboard = [];
    } else this.away += Math.sign(target - this.away) * Math.min(Math.abs(target - this.away), dt / SAIL);
    if (!crew && this.away === 0 && this.aboard.length) {
      this.aboard = [];
      this.onDocked?.();
    }
    if (!boat) return;
    const moored: THREE.Vector3 = (boat.userData.moored ??= boat.position.clone());
    const k = this.away * this.away * (3 - 2 * this.away); // ease in and out
    boat.position.copy(moored).setZ(moored.z + k * OUT);
    boat.position.y = moored.y + Math.sin(t * 1.3) * 0.015; // gently afloat
    boat.rotation.z = Math.sin(t * 0.9) * 0.03;
    boat.visible = this.away < 0.98;
    this.seat(boat, target);
  }

  /** The crew sitting in the boat, facing the way it's going (rebuilt when the crew or the boat changes). */
  private seat(boat: THREE.Object3D, target: number) {
    const key = this.aboard.map((r) => JSON.stringify(r)).join('|');
    if (this.seated?.boat !== boat || this.seated.key !== key) {
      const old = boat.getObjectByName('crew');
      if (old) {
        boat.remove(old);
        disposeObject(old);
      }
      const group = new THREE.Group();
      group.name = 'crew';
      const n = this.aboard.length;
      this.aboard.forEach((r, i) => {
        const c = buildCharacter(r).root;
        c.scale.setScalar(SEAT);
        // In a row along the boat, a little zigzag so they don't hide each other.
        c.position.set(n > 1 ? (i % 2 ? 0.07 : -0.07) : 0, 0.12, n > 1 ? -0.32 + (0.64 * i) / (n - 1) : 0);
        group.add(c);
      });
      boat.add(group);
      this.seated = { boat, key };
    }
    const group = boat.getObjectByName('crew');
    if (group) group.rotation.y = target ? 0 : Math.PI;
  }
}
