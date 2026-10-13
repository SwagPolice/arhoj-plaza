import * as THREE from 'three';
import type { Body, CharacterRecipe, Eyes, Mouth } from './recipe';
import { BLUSH, CREAM, INK, MOUTH_RED, WHITE } from './palette';
import { glaze } from '../scene/stage';
import { hashString, mulberry32 } from '../util/random';
import { colourAt, glazeMaterial } from './glaze';

export type Pt = [number, number];

// Body silhouettes as [radius, height] points, spun around the vertical axis (like a potter's wheel).
const BODY_PROFILES: Record<Body, Pt[]> = {
  // The classic Arhoj ghost: tall, straight-sided, rounded tip.
  ghost: [[0, 0], [0.2, 0], [0.37, 0], [0.395, 0.015], [0.4, 0.05], [0.37, 0.3], [0.32, 0.62], [0.27, 0.92], [0.22, 1.14], [0.16, 1.28], [0.08, 1.355], [0, 1.37]],
  cone: [[0, 0], [0.25, 0], [0.5, 0], [0.54, 0.05], [0.48, 0.22], [0.38, 0.48], [0.26, 0.74], [0.14, 0.95], [0.05, 1.07], [0, 1.1]],
  bell: [[0, 0], [0.27, 0], [0.54, 0], [0.57, 0.06], [0.5, 0.25], [0.44, 0.55], [0.4, 0.78], [0.3, 0.96], [0.14, 1.04], [0, 1.06]],
  bean: [[0, 0], [0.14, 0], [0.28, 0.01], [0.42, 0.08], [0.49, 0.3], [0.49, 0.6], [0.42, 0.86], [0.25, 1.0], [0, 1.04]],
  mushroom: [[0, 0], [0.18, 0], [0.38, 0], [0.4, 0.04], [0.37, 0.25], [0.35, 0.5], [0.33, 0.68], [0, 0.72]],
  blob: [[0, 0], [0.28, 0], [0.56, 0], [0.57, 0.05], [0.47, 0.2], [0.44, 0.5], [0.42, 0.75], [0.33, 0.95], [0.17, 1.05], [0, 1.08]],
};
const MUSHROOM_CAP: Pt[] = [[0, 0.6], [0.25, 0.59], [0.46, 0.58], [0.58, 0.62], [0.58, 0.7], [0.48, 0.85], [0.28, 0.95], [0, 0.98]];

// Highest the eyes can go, as a fraction of body height (lower on mushrooms so the cap doesn't hide them).
const EYE_TOP: Record<Body, number> = { ghost: 0.86, cone: 0.8, bell: 0.85, bean: 0.85, mushroom: 0.62, blob: 0.85 };

export type BuiltCharacter = {
  root: THREE.Group; // placed in the world
  pose: THREE.Group; // squashed, hopped and tilted by animation
  height: number;
  radius: number;
  look: Look; // move the pupils, for glances and expressions
};

export function sampleProfile(pts: Pt[], divisions = 64): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return curve.getPoints(divisions).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}

export function latheFrom(pts: Pt[], segments = 64) {
  const sampled = sampleProfile(pts);
  const geo = new THREE.LatheGeometry(sampled, segments);
  // Map texture v to height, so glaze layers line up the same way on every body shape.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const top = maxY(sampled);
  for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / top);
  return { geo, pts: sampled };
}

const maxY = (pts: THREE.Vector2[]) => Math.max(...pts.map((p) => p.y));
const maxR = (pts: THREE.Vector2[]) => Math.max(...pts.map((p) => p.x));

type Surface = { pts: THREE.Vector2[]; sx: number; sy: number };
const FORWARD = new THREE.Vector3(0, 0, 1);

/** Point and outward normal on the outside of a lathe shape, at profile height `py` and angle (0 = front). */
function surfacePoint(s: Surface, py: number, angle: number, lift = 0) {
  let best: { r: number; dr: number; dy: number } | null = null;
  for (let i = 0; i < s.pts.length - 1; i++) {
    const a = s.pts[i];
    const b = s.pts[i + 1];
    if (a.y === b.y || (a.y - py) * (b.y - py) > 0) continue;
    const t = (py - a.y) / (b.y - a.y);
    const r = a.x + (b.x - a.x) * t;
    if (!best || r > best.r) best = { r, dr: b.x - a.x, dy: b.y - a.y };
  }
  const { r, dr, dy } = best ?? { r: 0, dr: 0, dy: 1 };
  let nR = s.sy * dy;
  let nY = -s.sx * dr;
  const len = Math.hypot(nR, nY) || 1;
  nR /= len;
  nY /= len;
  if (nR < 0) {
    nR = -nR;
    nY = -nY;
  }
  const R = r * s.sx;
  const normal = new THREE.Vector3(Math.sin(angle) * nR, nY, Math.cos(angle) * nR);
  const pos = new THREE.Vector3(Math.sin(angle) * R, py * s.sy, Math.cos(angle) * R).addScaledVector(normal, lift);
  return { pos, normal, R };
}

/** Place an object on the surface, facing outward. */
function stick(obj: THREE.Object3D, s: Surface, py: number, angle: number, lift = 0) {
  const { pos, normal } = surfacePoint(s, py, angle, lift);
  obj.position.copy(pos);
  obj.quaternion.setFromUnitVectors(FORWARD, normal);
  return obj;
}

/** Curve a flat shape around a cylinder of radius R, so decals hug the body. */
function bend<G extends THREE.BufferGeometry>(geo: G, R: number): G {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, pos.getZ(i) - (R - Math.sqrt(Math.max(R * R - x * x, 0))));
  }
  return geo;
}

export function buildCharacter(r: CharacterRecipe): BuiltCharacter {
  const seed = hashString(r.id);
  const rand = mulberry32(seed);
  const sx = r.width;
  const sy = r.height;
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);

  const body = latheFrom(BODY_PROFILES[r.body]);
  const bodyMesh = new THREE.Mesh(body.geo, glazeMaterial(r, seed));
  bodyMesh.scale.set(sx, sy, sx);
  pose.add(bodyMesh);
  const bodySurface: Surface = { pts: body.pts, sx, sy };

  let top = maxY(body.pts) * sy;
  let radius = maxR(body.pts) * sx;
  let topSurface = bodySurface;
  if (r.body === 'mushroom') {
    const cap = latheFrom(MUSHROOM_CAP);
    const capMesh = new THREE.Mesh(cap.geo, glaze(r.topperColour));
    capMesh.scale.set(sx, sy, sx);
    pose.add(capMesh);
    topSurface = { pts: cap.pts, sx, sy };
    top = maxY(cap.pts) * sy;
    radius = Math.max(radius, maxR(cap.pts) * sx);
  }

  const look = addFace(pose, r, bodySurface);
  addTopper(pose, r, topSurface, top, rand);

  pose.traverse((o) => {
    // Decals sit a hair above the glaze; shadows at that distance just smudge them.
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = !o.userData.decal;
  });
  return { root, pose, height: top, radius, look };
}

// ---------- face ----------

function addFace(pose: THREE.Group, r: CharacterRecipe, s: Surface): Look {
  const top = maxY(s.pts);
  const hi = EYE_TOP[r.body];
  const lo = Math.min(hi, r.clayHeight + 0.06);
  const v = lo + r.eyeHeight * (hi - lo);
  const py = v * top;
  const size = r.eyeSize;
  const R = surfacePoint(s, py, 0).R;

  // Line-only eyes and painted mouths switch to cream on dark glazes; open eyes bring their own white.
  const dark = new THREE.Color(colourAt(r, v)).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35;
  const ink = decal(dark ? CREAM : INK);

  const placeAt = (worldDy: number, angle: number, obj: THREE.Object3D | null, lift = 0.004) => {
    if (!obj) return;
    stick(obj, s, py + worldDy / s.sy, angle, lift);
    pose.add(obj);
  };
  const radiusAt = (worldDy: number) => Math.max(surfacePoint(s, py + worldDy / s.sy, 0).R, 0.05);

  // Angle between the two eyes: from just touching up to 45°.
  // On a very narrow spot, touching wins over the 45° limit so the eyes never overlap.
  const touching = (2 * EYE_OUTER * size) / Math.max(R, 0.05);
  const apart = Math.max(touching, touching + r.eyeSpacing * (MAX_EYE_ANGLE - touching));

  const eyes = [-1, 1].map((side) => {
    const eye = makeEye(r.eyes, side, size, R, ink);
    placeAt(0, (side * apart) / 2, eye.object, 0.003);
    if (r.cheeks) placeAt(-0.05 * size, side * (apart / 2 + (0.07 * size) / radiusAt(-0.05 * size)), cheek());
    return eye;
  });
  placeAt(-0.085 * size, 0, makeMouth(r.mouth, ink, size, radiusAt(-0.085 * size)), 0.003);
  return (x, y) => eyes.forEach((e) => e.look(x, y));
}

/** Point the pupils: x and y from -1 to 1 (right/up positive, in the character's own frame). */
export type Look = (x: number, y: number) => void;

const MAX_EYE_ANGLE = Math.PI / 4;

/** Printed-on details: fully matte, so the ink stays black instead of mirroring the light. */
const decal = (color: string) => new THREE.MeshLambertMaterial({ color });
const EYE_WHITE = 0.052; // radius of the white, at eye size 1
const EYE_LINE = 0.0068; // outline thickness
const EYE_OUTER = EYE_WHITE + EYE_LINE;
const PUPIL = 0.024;

/** Half a ring: ∩ (or ∪ when `down`). */
function arc(radius: number, tube: number, mat: THREE.Material, down: boolean) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 24, Math.PI), mat);
  if (down) m.rotation.z = Math.PI;
  m.position.y = down ? radius * 0.5 : -radius * 0.5;
  return m;
}

function dot(radius: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), mat);
  m.scale.z = 0.45;
  return m;
}

/**
 * Arhoj-style printed eyes: flat decals curved to the body.
 * `side` is -1 for the eye on the character's right, 1 for its left.
 */
function makeEye(kind: Eyes, side: number, size: number, R: number, ink: THREE.Material): { object: THREE.Group; look: Look } {
  const g = new THREE.Group();
  // How far the body surface curves away at x, so things moved sideways stay on it.
  const curveZ = (x: number) => -(R - Math.sqrt(Math.max(R * R - x * x, 0)));
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(bend(geo, R), mat);
    m.position.z = z;
    m.userData.decal = true;
    parent.add(m);
    return m;
  };

  if (kind === 'sleepy' || kind === 'happy') {
    // Just a thin line: ∪ when sleeping, ∩ when happy.
    const inner = new THREE.Group();
    const rad = 0.04 * size;
    const t = EYE_LINE * 1.1 * size;
    const start = kind === 'sleepy' ? Math.PI : 0;
    flat(new THREE.RingGeometry(rad - t / 2, rad + t / 2, 40, 1, start, Math.PI), ink, 0, inner);
    for (const a of [start, start + Math.PI]) {
      const x = Math.cos(a) * rad;
      flat(new THREE.CircleGeometry(t / 2, 12), ink, 0, inner).position.set(x, Math.sin(a) * rad, curveZ(x));
    }
    inner.position.y = kind === 'sleepy' ? rad * 0.45 : -rad * 0.45;
    g.add(inner);
    return { object: g, look: () => {} };
  }

  const black = decal(INK);
  const white = decal(WHITE);
  const rIn = EYE_WHITE * size;
  flat(new THREE.CircleGeometry(rIn + 0.001, 48), white, 0);
  // The pupil is re-curved every time it moves, so it hugs the body wherever it slides to.
  const pupilGeo = new THREE.CircleGeometry(PUPIL * size, 32);
  const pupilX = Array.from({ length: pupilGeo.attributes.position.count }, (_, i) => pupilGeo.attributes.position.getX(i));
  const pupil = new THREE.Mesh(pupilGeo, black);
  pupil.userData.decal = true;
  g.add(pupil);
  flat(new THREE.RingGeometry(rIn, rIn + EYE_LINE * size, 64), black, 0.0024);

  if (kind === 'tired') {
    // A heavy eyelid: white cap over the top of the eye with a straight line under it.
    const h = 0.006 * size;
    const a0 = Math.asin(h / rIn);
    const lidShape = new THREE.Shape();
    lidShape.absarc(0, 0, rIn + 0.001, a0, Math.PI - a0, false);
    lidShape.closePath();
    const lid = new THREE.Group();
    flat(new THREE.ShapeGeometry(lidShape, 24), white, 0.0018, lid);
    const half = Math.sqrt(rIn * rIn - h * h);
    flat(new THREE.PlaneGeometry(2 * half, EYE_LINE * size, 16, 1), black, 0.0024, lid).position.y = h;
    lid.rotation.z = -side * 0.08; // droops a little towards the outside
    g.add(lid);
  }

  const reach = rIn - PUPIL * size - 0.004 * size;
  const look: Look = (x, y) => {
    let gx = x;
    let gy = y;
    if (kind === 'crossed') [gx, gy] = [-side * 0.9, 0]; // always looking at their own nose
    if (kind === 'tired') gy = -0.35; // pupils stay tucked under the lid
    const len = Math.hypot(gx, gy);
    if (len > 1) [gx, gy] = [gx / len, gy / len];
    const px = gx * reach;
    pupil.position.set(px, gy * reach, 0.0012);
    const pos = pupilGeo.attributes.position;
    pupilX.forEach((x, i) => pos.setZ(i, curveZ(px + x)));
    pos.needsUpdate = true;
  };
  look(0, 0);
  return { object: g, look };
}

function makeMouth(kind: Mouth, ink: THREE.Material, size: number, R: number): THREE.Object3D | null {
  if (kind === 'none') return null;
  // Wrapped in an outer group: stick() sets the outer transform, so inner flips and scales survive.
  const inner = new THREE.Group();
  if (kind === 'red') {
    // A tiny open mouth: half a disc, flat side up.
    const m = new THREE.Mesh(bend(new THREE.CircleGeometry(0.026 * size, 24, Math.PI, Math.PI), R), glaze(MOUTH_RED));
    m.position.y = 0.012 * size;
    m.userData.decal = true;
    return inner.add(m);
  }
  if (kind === 'smile') inner.add(arc(0.03, 0.01, ink, true));
  if (kind === 'o') {
    const m = dot(0.022, ink);
    m.scale.y = 1.2;
    inner.add(m);
  }
  if (kind === 'cat') {
    for (const side of [-1, 1]) {
      const a = arc(0.02, 0.009, ink, true);
      a.position.x = side * 0.02;
      inner.add(a);
    }
  }
  inner.scale.setScalar(size);
  return new THREE.Group().add(inner);
}

function cheek() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), glaze(BLUSH, { roughness: 0.6, clearcoat: 0.3 }));
  m.scale.set(1.3, 0.8, 0.3);
  return m;
}

// ---------- toppers ----------

function addTopper(pose: THREE.Group, r: CharacterRecipe, s: Surface, top: number, rand: () => number) {
  const accent = glaze(r.topperColour);
  if (r.topper === 'cap') {
    const beret = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16), accent);
    beret.scale.set(1, 0.42, 1);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), accent);
    nub.position.y = 0.085;
    const g = new THREE.Group().add(beret, nub);
    g.position.set(0.02, top - 0.02, 0);
    g.rotation.z = 0.22;
    pose.add(g);
  }
  if (r.topper === 'spots') {
    const onCap = r.body === 'mushroom';
    const mat = onCap ? glaze(CREAM) : accent;
    const height = maxY(s.pts);
    for (let i = 0; i < (onCap ? 9 : 7); i++) {
      const py = onCap ? 0.66 + rand() * 0.27 : height * (0.5 + rand() * 0.4);
      // Keep spots off the face (front = angle 0) unless they're on a mushroom cap.
      const angle = onCap ? rand() * Math.PI * 2 : Math.PI * (0.35 + rand() * 1.3);
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.035 + rand() * 0.035, 16, 10), mat);
      spot.scale.z = 0.35;
      pose.add(stick(spot, s, py, angle));
    }
  }
  if (r.topper === 'leaf') {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.16, 8), accent);
    stem.position.y = top + 0.06;
    pose.add(stem);
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 10), accent);
      leaf.scale.set(1.8, 0.35, 0.8);
      leaf.position.set(side * 0.085, top + 0.13, 0);
      leaf.rotation.z = side * 0.45;
      pose.add(leaf);
    }
  }
  if (r.topper === 'tiny-hat') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.022, 32), accent);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.17, 32), accent);
    crown.position.y = 0.095;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.035, 32), glaze(CREAM));
    band.position.y = 0.03;
    const g = new THREE.Group().add(brim, crown, band);
    g.position.y = top - 0.035;
    g.rotation.z = -0.12;
    pose.add(g);
  }
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}
