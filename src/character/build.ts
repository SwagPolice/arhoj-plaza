import * as THREE from 'three';
import type { Body, CharacterRecipe, Eyes, Mouth } from './recipe';
import { BLUSH, CLAY, CREAM, INK, WHITE } from './palette';
import { canvasTexture, glaze, makeCanvas, speckle } from '../scene/stage';
import { hashString, mulberry32 } from '../util/random';

export type Pt = [number, number];

// Body silhouettes as [radius, height] points, spun around the vertical axis (like a potter's wheel).
const BODY_PROFILES: Record<Body, Pt[]> = {
  cone: [[0, 0], [0.25, 0], [0.5, 0], [0.54, 0.05], [0.48, 0.22], [0.38, 0.48], [0.26, 0.74], [0.14, 0.95], [0.05, 1.07], [0, 1.1]],
  bell: [[0, 0], [0.27, 0], [0.54, 0], [0.57, 0.06], [0.5, 0.25], [0.44, 0.55], [0.4, 0.78], [0.3, 0.96], [0.14, 1.04], [0, 1.06]],
  ghost: [[0, 0], [0.28, 0], [0.56, 0], [0.57, 0.05], [0.47, 0.2], [0.44, 0.5], [0.42, 0.75], [0.33, 0.95], [0.17, 1.05], [0, 1.08]],
  bean: [[0, 0], [0.14, 0], [0.28, 0.01], [0.42, 0.08], [0.49, 0.3], [0.49, 0.6], [0.42, 0.86], [0.25, 1.0], [0, 1.04]],
  mushroom: [[0, 0], [0.18, 0], [0.38, 0], [0.4, 0.04], [0.37, 0.25], [0.35, 0.5], [0.33, 0.68], [0, 0.72]],
};
const MUSHROOM_CAP: Pt[] = [[0, 0.6], [0.25, 0.59], [0.46, 0.58], [0.58, 0.62], [0.58, 0.7], [0.48, 0.85], [0.28, 0.95], [0, 0.98]];

// Where the face sits, as a fraction of the (unscaled) profile height.
const FACE_Y: Record<Body, number> = { cone: 0.42, bell: 0.48, ghost: 0.55, bean: 0.55, mushroom: 0.3 };

const DRIP_EDGE = 0.17; // glaze stops this far up the body, leaving bare clay below

export type BuiltCharacter = {
  root: THREE.Group; // placed in the world
  pose: THREE.Group; // squashed, hopped and tilted by animation
  height: number;
  radius: number;
};

export function sampleProfile(pts: Pt[], divisions = 64): THREE.Vector2[] {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return curve.getPoints(divisions).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}

export function latheFrom(pts: Pt[], segments = 64) {
  const sampled = sampleProfile(pts);
  const geo = new THREE.LatheGeometry(sampled, segments);
  // Map texture v to height, so glaze drips line up the same way on every body shape.
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

export function buildCharacter(r: CharacterRecipe): BuiltCharacter {
  const rand = mulberry32(hashString(r.id));
  const sx = r.width;
  const sy = r.height;
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);

  const body = latheFrom(BODY_PROFILES[r.body]);
  const bodyMesh = new THREE.Mesh(body.geo, bodyMaterial(r, rand));
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

  addFace(pose, r, bodySurface);
  addTopper(pose, r, topSurface, top, rand);

  pose.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return { root, pose, height: top, radius };
}

// ---------- glaze ----------

type Drip = { x: number; w: number; len: number };

function bodyMaterial(r: CharacterRecipe, rand: () => number): THREE.MeshPhysicalMaterial {
  if (r.glazeFinish === 'glossy') return glaze(r.glaze);
  const W = 512;
  const H = 256;
  const drips: Drip[] =
    r.glazeFinish === 'drip'
      ? Array.from({ length: 16 }, () => ({ x: rand() * W, w: 10 + rand() * 22, len: 4 + rand() * 22 }))
      : [];
  const paint = (ctx: CanvasRenderingContext2D, glazeFill: string, clayFill: string) => {
    const edge = H * (1 - DRIP_EDGE);
    ctx.fillStyle = clayFill;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = glazeFill;
    ctx.fillRect(0, 0, W, edge);
    for (const d of drips) {
      for (const x of [d.x - W, d.x, d.x + W]) {
        ctx.fillRect(x - d.w / 2, edge - 1, d.w, d.len);
        ctx.beginPath();
        ctx.arc(x, edge + d.len, d.w / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  const colour = makeCanvas(W, H, (ctx) => {
    if (drips.length) paint(ctx, r.glaze, CLAY);
    else {
      ctx.fillStyle = r.glaze;
      ctx.fillRect(0, 0, W, H);
    }
    speckle(ctx, W, H, rand, drips.length ? 500 : 1400);
  });
  const map = canvasTexture(colour, true);
  map.offset.x = 0.5; // keep the texture seam at the back
  const mat = glaze('#ffffff', { map });

  if (drips.length) {
    // Bare clay is matte; glazed part is glossy.
    const rough = canvasTexture(makeCanvas(W, H, (ctx) => paint(ctx, 'rgb(80,80,80)', 'rgb(235,235,235)')), false);
    const coat = canvasTexture(makeCanvas(W, H, (ctx) => paint(ctx, '#fff', '#000')), false);
    rough.offset.x = coat.offset.x = 0.5;
    mat.roughness = 1;
    mat.roughnessMap = rough;
    mat.clearcoatMap = coat;
  }
  return mat;
}

// ---------- face ----------

function addFace(pose: THREE.Group, r: CharacterRecipe, s: Surface) {
  // Dark glazes get light faces so they stay readable.
  const dark = new THREE.Color(r.glaze).getHSL({ h: 0, s: 0, l: 0 }).l < 0.35;
  const ink = glaze(dark ? CREAM : INK, { roughness: 0.25 });
  const faceY = FACE_Y[r.body] * s.sy;
  const place = (worldY: number, arc: number, obj: THREE.Object3D | null) => {
    if (!obj) return;
    const py = worldY / s.sy;
    const R = surfacePoint(s, py, 0).R;
    stick(obj, s, py, arc / Math.max(R, 0.05), 0.004);
    pose.add(obj);
  };
  for (const side of [-1, 1]) {
    place(faceY + 0.04, side * 0.1, makeEye(r.eyes, ink));
    if (r.cheeks) place(faceY - 0.015, side * 0.19, cheek());
  }
  place(faceY - 0.045, 0, makeMouth(r.mouth, ink));
}

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

function makeEye(kind: Eyes, ink: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  if (kind === 'dots') g.add(dot(0.04, ink));
  if (kind === 'wide') {
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 8), glaze(WHITE));
    shine.position.set(0.018, 0.02, 0.026);
    g.add(dot(0.058, ink), shine);
  }
  if (kind === 'closed') g.add(arc(0.036, 0.011, ink, false));
  if (kind === 'sleepy') {
    const line = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.055, 4, 8), ink);
    line.rotation.z = Math.PI / 2;
    g.add(line);
  }
  return g;
}

function makeMouth(kind: Mouth, ink: THREE.Material): THREE.Object3D | null {
  // Wrapped in a group: stick() sets the outer transform, so the arc keeps its own flip.
  if (kind === 'smile') return new THREE.Group().add(arc(0.03, 0.01, ink, true));
  if (kind === 'o') {
    const m = dot(0.022, ink);
    m.scale.y = 1.2;
    return m;
  }
  if (kind === 'cat') {
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const a = arc(0.02, 0.009, ink, true);
      a.position.x = side * 0.02;
      g.add(a);
    }
    return g;
  }
  return null;
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
