import * as THREE from 'three';
import { latheFrom, stick, type Pt, type Surface } from '../character/build';
import { canvasTexture, makeCanvas } from '../scene/stage';
import { mulberry32 } from '../util/random';

/*
 * The balloon merchant: a tall stoneware egg in an even, thick, crawling white glaze, speckled with iron,
 * with an unglazed foot and two eyes pierced right through. A small basket for his wares hangs below.
 * (After an Arhoj piece: see the merchant section of the Studio Mode design doc.)
 */

// Narrow foot, widest a little above the middle, a full round dome on top.
const EGG: Pt[] = [
  [0, 0], [0.22, 0], [0.25, 0.015], [0.265, 0.05], [0.31, 0.14], [0.37, 0.28], [0.42, 0.44], [0.445, 0.6],
  [0.445, 0.76], [0.42, 0.92], [0.37, 1.07], [0.29, 1.2], [0.19, 1.3], [0.09, 1.355], [0, 1.37],
];

const W = 1024;
const H = 512;
const BASE = '#e2ded5'; // warm off-white
const FOOT = '#d6c69f'; // bare stoneware
const FOOT_V = 0.045; // height of the unglazed foot
const EYE_V = 0.72; // eyes, as a fraction of height
const EYE_ANGLE = 0.2; // each eye this far from the front (radians)
const HOLE = 0.034;

type Lump = { x: number; y: number; r: number; turn: number };

/** Clumps of crawled glaze: a few big raised patches made of overlapping blobs, plus scattered small ones. */
function lumps(rand: () => number): Lump[] {
  const out: Lump[] = [];
  for (let c = 0; c < 70; c++) {
    const cx = rand() * W;
    const cy = H * (0.04 + rand() * 0.9);
    const n = 3 + Math.floor(rand() * 9);
    for (let i = 0; i < n; i++) out.push({ x: cx + (rand() - 0.5) * 46, y: cy + (rand() - 0.5) * 30, r: 3 + rand() * 9, turn: rand() * Math.PI });
  }
  for (let i = 0; i < 260; i++) out.push({ x: rand() * W, y: H * (0.04 + rand() * 0.92), r: 1.5 + rand() * 3.5, turn: rand() * Math.PI });
  return out;
}

/** An irregular lump: a squashed, turned oval (the same one every time for the same lump). */
function blob(ctx: CanvasRenderingContext2D, x: number, b: Lump) {
  ctx.beginPath();
  ctx.ellipse(x, b.y, b.r * 1.5, b.r * 0.8, b.turn, 0, Math.PI * 2);
  ctx.fill();
}

/** Canvas row for a height fraction (canvas top is the tip). */
const row = (v: number) => H * (1 - v);

/** Paint around the seam too, so nothing gets cut off at the back. */
function wrapped(x: number, draw: (x: number) => void) {
  draw(x);
  if (x < 60) draw(x + W);
  if (x > W - 60) draw(x - W);
}

function merchantMaterial(seed: number) {
  const rand = mulberry32(seed);
  const blobs = lumps(rand);

  const colour = makeCanvas(W, H, (ctx) => {
    ctx.fillStyle = BASE;
    ctx.fillRect(0, 0, W, H);
    // Soft clouds where the glaze ran thicker or thinner.
    for (let i = 0; i < 90; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const light = rand() < 0.55;
      g.addColorStop(0, light ? 'rgba(248,246,240,0.18)' : 'rgba(200,196,186,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      const x = rand() * W;
      const y = rand() * H;
      const r = 30 + rand() * 90;
      wrapped(x, (px) => {
        ctx.save();
        ctx.translate(px, y);
        ctx.scale(r, r * 0.6);
        ctx.fillStyle = g;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      });
    }
    // Thick lumps are only a touch whiter: they show mostly as relief (the bump map below).
    for (const b of blobs) {
      ctx.fillStyle = `rgba(245,245,240,${0.12 + rand() * 0.18})`;
      wrapped(b.x, (x) => blob(ctx, x, b));
    }
    // Iron speckle, fine and plentiful.
    for (let i = 0; i < 3400; i++) {
      ctx.fillStyle = `rgba(62,52,44,${0.4 + rand() * 0.5})`;
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * H, 0.6 + rand() * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Bare foot, with a slightly ragged glaze line above it.
    ctx.fillStyle = FOOT;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) ctx.lineTo(x, row(FOOT_V + (rand() - 0.3) * 0.012));
    ctx.lineTo(W, H);
    ctx.fill();
  });

  // Height map for the bump: raised lumps, faint throwing rings, a smooth foot.
  const bump = makeCanvas(W, H, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 6 + rand() * 10) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${0.015 + rand() * 0.02})`;
      ctx.fillRect(0, y, W, 2.5);
    }
    ctx.filter = 'blur(1.5px)';
    for (const b of blobs) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.7, 'rgba(230,230,230,0.6)');
      g.addColorStop(1, 'rgba(128,128,128,0)');
      wrapped(b.x, (x) => {
        ctx.save();
        ctx.translate(x, b.y);
        ctx.fillStyle = g;
        blob(ctx, 0, { ...b, y: 0 });
        ctx.restore();
      });
    }
    ctx.filter = 'none';
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, row(FOOT_V - 0.005), W, H);
  });

  // Satin glaze, rough bare clay.
  const rough = makeCanvas(W, H, (ctx) => {
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, row(FOOT_V), W, H);
  });

  const map = canvasTexture(colour, true);
  const bumpMap = canvasTexture(bump, false);
  const roughnessMap = canvasTexture(rough, false);
  map.offset.x = bumpMap.offset.x = roughnessMap.offset.x = 0.5; // seam at the back, like the characters
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    map,
    bumpMap,
    bumpScale: 4,
    roughness: 1,
    roughnessMap,
    clearcoat: 0.15,
    clearcoatRoughness: 0.5,
  });
}

/** A pierced eye: a dark hole, shaded deeper in the middle, with a little raised lip of glaze. */
function hole(lip: THREE.Material) {
  const shade = canvasTexture(
    makeCanvas(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 36, 2, 32, 32, 32);
      g.addColorStop(0, '#050403');
      g.addColorStop(0.65, '#1a1612');
      g.addColorStop(1, '#4a4038');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }),
    true,
  );
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CircleGeometry(HOLE, 24), new THREE.MeshBasicMaterial({ map: shade })));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(HOLE + 0.004, 0.006, 8, 28), lip);
  g.add(rim);
  return g;
}

const WICKER = '#c79a62';
const BASKET: Pt[] = [[0, 0], [0.15, 0], [0.19, 0.02], [0.21, 0.08], [0.225, 0.2], [0.235, 0.215], [0.215, 0.22], [0.2, 0.08], [0.16, 0.035], [0, 0.03]];
const BASKET_DROP = 0.42; // gap between his foot and the basket's rim
const BASKET_TOP = 0.22;

/** A little woven basket: rows of staggered weave, as colour and relief. */
function wickerMaterial() {
  const paint = (ctx: CanvasRenderingContext2D, light: string, dark: string) => {
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, 256, 128);
    for (let y = 0; y < 128; y += 8)
      for (let x = (y / 8) % 2 ? 0 : 8; x < 256; x += 16) {
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.ellipse(x + 4, y + 4, 7, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
  };
  const map = canvasTexture(makeCanvas(256, 128, (ctx) => paint(ctx, WICKER, '#8a6238')), true);
  const bumpMap = canvasTexture(makeCanvas(256, 128, (ctx) => paint(ctx, '#ffffff', '#202020')), false);
  map.repeat.x = bumpMap.repeat.x = 2;
  return new THREE.MeshPhysicalMaterial({ color: '#ffffff', map, bumpMap, bumpScale: 1.5, roughness: 0.85 });
}

/** A thin rope from a to b. */
function rope(a: THREE.Vector3, b: THREE.Vector3, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** The basket hanging under him on four ropes, with a few little glazed wares peeking out. In his own frame (foot at y = 0). */
function basket() {
  const g = new THREE.Group();
  const cup = new THREE.Group();
  const body = new THREE.Mesh(latheFrom(BASKET, 48).geo, wickerMaterial());
  body.castShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.014, 8, 40), new THREE.MeshPhysicalMaterial({ color: '#9c7140', roughness: 0.8 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = BASKET_TOP;
  cup.add(body, rim);
  // Wares: a tiny pot, a glossy ball and a little cone, in glaze colours.
  const ware = (geo: THREE.BufferGeometry, colour: string, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.25, clearcoat: 1 }));
    m.position.set(x, y, z);
    cup.add(m);
  };
  ware(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 20), '#3fae9a', -0.07, 0.2, 0.04);
  ware(new THREE.SphereGeometry(0.065, 20, 14), '#f2c230', 0.08, 0.2, 0.03);
  ware(new THREE.ConeGeometry(0.05, 0.14, 20), '#d8382f', 0, 0.22, -0.08);
  cup.position.y = -BASKET_DROP - BASKET_TOP;
  g.add(cup);
  // Ropes from four points round the rim up to his lower body.
  const ropeMat = new THREE.MeshLambertMaterial({ color: '#a88a62' });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const low = new THREE.Vector3(Math.sin(a) * 0.22, -BASKET_DROP, Math.cos(a) * 0.22);
    const high = new THREE.Vector3(Math.sin(a) * 0.3, 0.13, Math.cos(a) * 0.3);
    g.add(rope(low, high, ropeMat));
  }
  return g;
}

export type MerchantModel = { root: THREE.Group; height: number };

/** The merchant, his foot at y = 0 and his basket hanging below; at scale 1 he's about as tall as a tall ghost. */
export function buildMerchant(seed = 3): MerchantModel {
  const root = new THREE.Group();
  const egg = latheFrom(EGG, 96);
  const body = new THREE.Mesh(egg.geo, merchantMaterial(seed));
  body.castShadow = true;
  root.add(body);
  const s: Surface = { pts: egg.pts, sx: 1, sy: 1 };
  const top = 1.37;
  const lip = new THREE.MeshPhysicalMaterial({ color: BASE, roughness: 0.6, clearcoat: 0.1 });
  for (const side of [-1, 1]) root.add(stick(hole(lip), s, EYE_V * top, side * EYE_ANGLE, 0.002));
  root.add(basket());
  return { root, height: top };
}
