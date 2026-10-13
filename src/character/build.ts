import * as THREE from 'three';
import type { Body, CharacterRecipe, Eyes } from './recipe';
import { CREAM, INK, MOUTH_RED, WHITE } from './palette';
import { hashString } from '../util/random';
import { colourAt, glazeMaterial } from './glaze';

export type Pt = [number, number];

// Body silhouettes as [radius, height] points, spun around the vertical axis (like a potter's wheel).
const BODY_PROFILES: Record<Body, Pt[]> = {
  // The classic Arhoj ghost: tall, straight-sided, rounded tip.
  ghost: [[0, 0], [0.2, 0], [0.37, 0], [0.395, 0.015], [0.4, 0.05], [0.37, 0.3], [0.32, 0.62], [0.27, 0.92], [0.22, 1.14], [0.16, 1.28], [0.08, 1.355], [0, 1.37]],
  cone: [[0, 0], [0.25, 0], [0.5, 0], [0.54, 0.05], [0.48, 0.22], [0.38, 0.48], [0.26, 0.74], [0.14, 0.95], [0.05, 1.07], [0, 1.1]],
  bell: [[0, 0], [0.27, 0], [0.54, 0], [0.57, 0.06], [0.5, 0.25], [0.44, 0.55], [0.4, 0.78], [0.3, 0.96], [0.14, 1.04], [0, 1.06]],
  bean: [[0, 0], [0.14, 0], [0.28, 0.01], [0.42, 0.08], [0.49, 0.3], [0.49, 0.6], [0.42, 0.86], [0.25, 1.0], [0, 1.04]],
  blob: [[0, 0], [0.28, 0], [0.56, 0], [0.57, 0.05], [0.47, 0.2], [0.44, 0.5], [0.42, 0.75], [0.33, 0.95], [0.17, 1.05], [0, 1.08]],
};

// Highest the eyes can go, as a fraction of body height.
const EYE_TOP: Record<Body, number> = { ghost: 0.86, cone: 0.8, bell: 0.85, bean: 0.85, blob: 0.85 };

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

  const top = maxY(body.pts) * sy;
  const radius = maxR(body.pts) * sx;
  const look = addFace(pose, r, bodySurface);

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

  // Line-only eyes switch to cream on dark glazes; open eyes bring their own white.
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
    return eye;
  });
  if (r.mouth === 'red') placeAt(-0.085 * size, 0, tinyMouth(size, radiusAt(-0.085 * size)), 0.003);
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
  const base = pupilGeo.attributes.position;
  const pupilShape = Array.from({ length: base.count }, (_, i) => [base.getX(i), base.getY(i)]);
  const pupil = new THREE.Mesh(pupilGeo, black);
  pupil.position.z = 0.0012;
  // For tired eyes: the highest the pupil may reach at x (just under the lid line).
  let lidLimit: ((x: number) => number) | null = null;
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
    const tilt = -side * 0.08; // droops a little towards the outside
    lid.rotation.z = tilt;
    g.add(lid);
    // The lid line, rotated with the lid: y = h / cos(tilt) + tan(tilt) * x. Keep the pupil below its underside.
    lidLimit = (x) => (h - (EYE_LINE * size) / 2) / Math.cos(tilt) + Math.tan(tilt) * x;
  }

  const reach = rIn - PUPIL * size - 0.004 * size;
  const look: Look = (x, y) => {
    let gx = x;
    let gy = y;
    if (kind === 'crossed') [gx, gy] = [-side * 0.9, 0]; // always looking at their own nose
    if (kind === 'tired') gy = -0.35; // pupils stay tucked under the lid
    const len = Math.hypot(gx, gy);
    if (len > 1) [gx, gy] = [gx / len, gy / len];
    const cx = gx * reach;
    const cy = gy * reach;
    // Rewrite the pupil's outline in place: moved, cut off under the lid, and curved to the body.
    pupilShape.forEach(([bx, by], i) => {
      const x = cx + bx;
      const y = lidLimit ? Math.min(cy + by, lidLimit(x)) : cy + by;
      base.setXYZ(i, x, y, curveZ(x));
    });
    base.needsUpdate = true;
    pupilGeo.computeBoundingSphere();
  };
  look(0, 0);
  return { object: g, look };
}

/** The occasional tiny red mouth: half a disc, flat side up. */
function tinyMouth(size: number, R: number) {
  const m = new THREE.Mesh(bend(new THREE.CircleGeometry(0.026 * size, 24, Math.PI, Math.PI), R), decal(MOUTH_RED));
  m.position.y = 0.012 * size;
  m.userData.decal = true;
  return new THREE.Group().add(m);
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
