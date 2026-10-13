import * as THREE from 'three';
import type { Glass } from './recipe';
import { canvasTexture, glaze, makeCanvas } from '../scene/stage';
import { mulberry32 } from '../util/random';

const W = 512;
const H = 256;

/** The thick clear glass around the stem. Everything behind it (the core, the island) shows through, refracted. */
export function shellMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    transmission: 1,
    thickness: 0.08, // real glass this thick would magnify the core to fill the stem; less reads better
    ior: 1.5,
    roughness: 0.03,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
}

/** The coloured core inside the stem: smooth and solid, or frosted with fine white fizz. */
export function coreMaterial(g: Glass, seed: number) {
  if (g.coreFinish === 'solid') return glaze(g.core, { roughness: 0.25, clearcoat: 0.4 });
  const rand = mulberry32(seed + 3);
  const map = canvasTexture(
    makeCanvas(W, H, (ctx) => {
      ctx.fillStyle = g.core;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 5000; i++) {
        ctx.fillStyle = rand() < 0.8 ? `rgba(255,255,255,${0.4 + rand() * 0.5})` : `rgba(40,30,60,${0.2 + rand() * 0.3})`;
        ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 1.5, 1 + rand() * 1.5);
      }
    }),
    true,
  );
  return new THREE.MeshPhysicalMaterial({ color: '#ffffff', map, roughness: 0.75 });
}

/**
 * The cap: tinted glass for plain, dots and glitter (dots are added as decals separately);
 * clear glass with opaque coloured flecks for confetti.
 */
export function capMaterial(g: Glass, seed: number) {
  const rand = mulberry32(seed + 5);
  if (g.capPattern === 'confetti') {
    const flecks: { x: number; y: number; r: number; colour: string; pts: number[] }[] = Array.from({ length: 700 }, () => ({
      x: rand() * W,
      y: rand() * H,
      r: 2 + rand() * rand() * 7,
      colour: rand() < 0.5 ? g.capPatternColour : g.cap,
      pts: Array.from({ length: 6 }, () => 0.5 + rand() * 0.6),
    }));
    // Irregular little shards, painted the same way on every map so they line up.
    const paint = (ctx: CanvasRenderingContext2D, base: string, fleck: (c: string) => string) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);
      for (const f of flecks) {
        ctx.fillStyle = fleck(f.colour);
        ctx.beginPath();
        f.pts.forEach((k, i) => {
          const a = (i / f.pts.length) * Math.PI * 2;
          ctx.lineTo(f.x + Math.cos(a) * f.r * k, f.y + Math.sin(a) * f.r * k);
        });
        ctx.fill();
      }
    };
    const map = canvasTexture(makeCanvas(W, H, (ctx) => paint(ctx, '#ffffff', (c) => c)), true);
    // Clear everywhere except the flecks (transmission map: white = see-through, black = solid).
    const transmissionMap = canvasTexture(makeCanvas(W, H, (ctx) => paint(ctx, '#ffffff', () => '#000000')), false);
    return new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map,
      transmission: 1,
      transmissionMap,
      thickness: 0.5,
      ior: 1.5,
      roughness: 0.04,
      clearcoat: 1,
    });
  }

  const mat = new THREE.MeshPhysicalMaterial({
    color: g.cap,
    transmission: 0.35,
    thickness: 0.5,
    ior: 1.5,
    roughness: 0.06,
    attenuationColor: new THREE.Color(g.cap),
    attenuationDistance: 0.6,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  if (g.capPattern === 'glitter') {
    // Fine sparkles suspended in the glass, with a little rainbow sheen.
    mat.color.set('#ffffff');
    mat.map = canvasTexture(
      makeCanvas(W, H, (ctx) => {
        ctx.fillStyle = g.cap;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 3500; i++) {
          ctx.fillStyle = rand() < 0.6 ? `rgba(255,255,255,${0.5 + rand() * 0.5})` : g.capPatternColour;
          ctx.fillRect(rand() * W, rand() * H, 1 + rand(), 1 + rand());
        }
      }),
      true,
    );
    mat.iridescence = 0.6;
  }
  return mat;
}
