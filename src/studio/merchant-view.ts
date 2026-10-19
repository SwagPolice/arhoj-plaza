import * as THREE from 'three';
import { buildMerchant } from './merchant-model';

const FLY = 6; // seconds to float in from the horizon, or away again
const FAR = new THREE.Vector3(14, 7, -26); // where he comes from, relative to where he hovers
const DRIFT = 0.5; // at most this far either way along the island's edge (radians, about 30°)
const DRIFT_TIME = 40; // seconds for one sweep there and back
const BOB = 0.08;
const HANG = 0.64; // how far his basket hangs below his foot, at scale 1
const WATER = -1.1;
const CLEAR = 0.5; // the basket's lowest point stays at least this far above the water
const BIGGEST = 2; // his size at his furthest step: spots are chosen so he fits even then

/**
 * The merchant in the scene: floats in from far away, hovers by the island (drifting slowly to and fro along its
 * edge, bobbing, and turned towards you), and floats off again. Growing (a new step) eases him to his new size;
 * he rides higher as he grows, so his basket never dips into the sea.
 */
export class MerchantBalloon {
  readonly root: THREE.Group;
  readonly height: number;
  private angle = 0; // where he hovers round the island (from +z towards +x)
  private drift = DRIFT; // how far he drifts either way from there (less where the screen is tight)
  private distance = 6; // how far from the island's middle
  private camera: THREE.Camera | null = null;
  private radius = 5;
  private local = new THREE.Box3(); // his outline at scale 1, from his foot
  private fit = 1; // drawn a little smaller when the screen is too tight for his full size
  private flight: { from: THREE.Vector3; t: number; away: boolean; to?: THREE.Vector3 } | null = null;
  private scale = 1;
  private targetScale = 1;
  private clock = 0;

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
   * Find where he hovers: just off the island's edge, at the spot where he fits best on screen (clear of the HUD
   * at the top and the build bar at the bottom), drifting only as far as he stays in view. Checked again when the
   * screen changes shape or he grows.
   */
  setSpot(radius: number, camera: THREE.Camera) {
    this.camera = camera;
    this.radius = radius;
    camera.updateMatrixWorld(); // projecting needs the camera where it is now
    if (this.local.isEmpty()) {
      const was = [this.root.position.clone(), this.root.scale.clone(), this.root.rotation.clone()];
      this.root.position.set(0, 0, 0);
      this.root.scale.setScalar(1);
      this.root.rotation.set(0, 0, 0);
      this.root.updateMatrixWorld(true);
      this.local.setFromObject(this.root);
      this.root.position.copy(was[0] as THREE.Vector3);
      this.root.scale.copy(was[1] as THREE.Vector3);
      this.root.rotation.copy(was[2] as THREE.Euler);
    }
    const step = Math.PI / 18; // look every 10° round the island
    // Never in front of the island (he'd hide it): only the sides and the back.
    const allowed = (i: number) => Math.cos(i * step) < 0.25;
    // Prefer the right side and the back (the harbour is on the left).
    const score = (misfit: number, i: number) => misfit + (Math.sin(i * step) < 0 ? 0.3 : 0);
    let chosen: { fit: number; distance: number; angle: number; drift: number } | null = null;
    // The biggest size (one factor for every step, worked out for his biggest, so growing still looks like growing)
    // that fits with a little room to drift; off the edge first, else over the rim or the back of the island.
    for (let fit = 1; fit >= 0.6 && !chosen; fit = Math.round((fit - 0.05) * 100) / 100) {
      for (const distance of [radius + 1.1, radius + 0.3, radius * 0.7]) {
        this.distance = distance;
        const s = Math.max(BIGGEST, this.targetScale) * fit;
        const fits = Array.from({ length: 36 }, (_, i) => (allowed(i) ? this.misfit(i * step, s) : Infinity));
        const best = fits.reduce((b, f, i) => (score(f, i) < score(fits[b], b) ? i : b), 9);
        if (fits[best] > 0.92) continue;
        const ok = (i: number) => fits[((i % 36) + 36) % 36] <= 0.92;
        let lo = 0;
        let hi = 0;
        while (lo < 3 && ok(best - lo - 1)) lo++;
        while (hi < 3 && ok(best + hi + 1)) hi++;
        if (lo + hi < 2 && fit > 0.6) continue; // want a little room to drift, unless we're out of sizes
        chosen = { fit, distance, angle: (best + (hi - lo) / 2) * step, drift: Math.min(DRIFT, ((hi + lo) / 2) * step) };
        break;
      }
    }
    chosen ??= { fit: 0.6, distance: radius * 0.7, angle: Math.PI * 0.75, drift: 0.2 };
    this.fit = chosen.fit;
    this.distance = chosen.distance;
    this.angle = chosen.angle;
    this.drift = chosen.drift;
  }

  /** How badly he'd fit on screen hovering at this angle: 0 is the middle, above 1 is off the edge (or under the HUD). */
  private misfit(angle: number, scale: number) {
    if (!this.camera) return 0;
    const foot = new THREE.Vector3(Math.sin(angle) * this.distance, this.height0(scale), Math.cos(angle) * this.distance);
    let worst = -Infinity;
    for (const x of [this.local.min.x, this.local.max.x])
      for (const y of [this.local.min.y, this.local.max.y])
        for (const z of [this.local.min.z, this.local.max.z]) {
          const v = new THREE.Vector3(x, y, z).multiplyScalar(scale).add(foot).project(this.camera);
          worst = Math.max(worst, Math.abs(v.x), v.y + 0.15, -v.y - 0.72); // the HUD band at the top, the bar at the bottom
        }
    return worst;
  }

  /** His foot's height before bobbing: low, but with his basket always clear of what's below (the sea, or the island). */
  private height0(scale: number) {
    const below = this.distance < this.radius + 0.6 ? 0 : WATER; // over the island (or its rim), or out over the water
    return Math.max(0.3, below + CLEAR + HANG * scale + BOB);
  }

  /** Where he hovers right now: drifting along the edge, bobbing, high enough for his basket to clear the water. */
  private hover(out = new THREE.Vector3()) {
    const t = this.clock;
    const a = this.angle + this.drift * Math.sin((t * Math.PI * 2) / DRIFT_TIME);
    const y = this.height0(this.scale * this.fit) + Math.sin(t * 1.1) * BOB;
    return out.set(Math.sin(a) * this.distance, y, Math.cos(a) * this.distance);
  }

  /** Already here (after loading or coming back): appear in place. */
  show(scale: number) {
    this.scale = this.targetScale = scale;
    this.root.scale.setScalar(scale * this.fit);
    this.hover(this.root.position);
    this.root.visible = true;
    this.flight = null;
  }

  arrive(scale: number) {
    this.show(scale);
    const from = this.hover().add(FAR);
    this.root.position.copy(from);
    this.flight = { from, t: 0, away: false };
  }

  leave() {
    if (!this.root.visible) return;
    const from = this.root.position.clone();
    this.flight = { from, to: from.clone().add(FAR), t: 0, away: true };
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
    return this.height * this.scale * this.fit + 0.2;
  }

  update(dt: number, t: number, camera: THREE.Camera) {
    this.clock += dt;
    if (!this.root.visible) return;
    this.scale += (this.targetScale - this.scale) * Math.min(1, dt * 2);
    this.root.scale.setScalar(this.scale * this.fit);
    const p = this.root.position;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / FLY);
      const k = f.t * f.t * (3 - 2 * f.t); // ease in and out
      p.lerpVectors(f.from, f.to ?? this.hover(), k); // arriving: towards wherever his drift has got to
      if (f.t >= 1) {
        this.flight = null;
        if (f.away) this.root.visible = false;
      }
    } else this.hover(p);
    this.root.rotation.set(0, Math.atan2(camera.position.x - p.x, camera.position.z - p.z), Math.sin(t * 0.7) * 0.04);
  }
}
