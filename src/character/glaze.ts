import * as THREE from 'three';
import type { CharacterRecipe, Finish, GlazeLayer } from './recipe';
import { CLAY } from './palette';
import { canvasTexture, glaze, makeCanvas } from '../scene/stage';
import { mulberry32 } from '../util/random';

// Texture covers the body: u = around, v = height (0 = base, 1 = tip).
const W = 1024;
const H = 512;

type RGB = [number, number, number];

// [clearcoat, roughness, metalness], packed into the R, G, B channels of one texture.
const SURFACE: Record<Finish | 'clay', RGB> = {
  glossy: [1, 0.26, 0],
  satin: [0.15, 0.55, 0],
  metallic: [0.5, 0.16, 1],
  clay: [0, 0.95, 0],
};

const hexRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const unitRgb = (v: RGB): RGB => v.map((c) => Math.round(c * 255)) as RGB;
const css = ([r, g, b]: RGB, a = 1) => `rgba(${r},${g},${b},${a})`;

/** Bottom of a layer as a fraction of body height. Layer 0 reaches the clay; later ones are dipped from the top. */
export function layerBottom(r: CharacterRecipe, i: number) {
  const reach = i === 0 ? 1 : r.layers[i].reach;
  return r.clayHeight + (1 - r.clayHeight) * (1 - reach);
}

/** Roughly which glaze colour shows at height v (ignores drips). */
export function colourAt(r: CharacterRecipe, v: number): string {
  let c = CLAY;
  r.layers.forEach((l, i) => {
    if (v >= layerBottom(r, i)) c = l.colour;
  });
  return c;
}

type Shape = {
  y: number; // canvas y of the edge
  tilt: number; // dips are never perfectly level
  phase: number;
  wiggle: number;
  wigglePhase: number;
  wiggleFreq: number;
  drips: { x: number; w: number; len: number }[];
};

function layerShape(layer: GlazeLayer, bottomV: number, rand: () => number): Shape {
  return {
    y: H * (1 - bottomV),
    tilt: (rand() - 0.5) * 16,
    phase: rand() * Math.PI * 2,
    wiggle: layer.edge === 'wavy' ? 6 + rand() * 6 : 0,
    wigglePhase: rand() * Math.PI * 2,
    wiggleFreq: 3 + Math.floor(rand() * 3),
    drips:
      layer.edge === 'drips'
        ? Array.from({ length: 10 + Math.floor(rand() * 10) }, () => ({
            x: rand() * W,
            w: 8 + rand() * 20,
            len: 8 + rand() * rand() * 130,
          }))
        : [],
  };
}

const edgeY = (s: Shape, x: number) =>
  s.y +
  s.tilt * Math.sin((x / W) * Math.PI * 2 + s.phase) +
  s.wiggle * Math.sin((x / W) * Math.PI * 2 * s.wiggleFreq + s.wigglePhase);

/** Paint the area a layer covers: everything above its edge, plus drips. */
function fillRegion(ctx: CanvasRenderingContext2D, s: Shape, fade: boolean, rgb: RGB) {
  if (fade) {
    const g = ctx.createLinearGradient(0, s.y - 90, 0, s.y + 30);
    g.addColorStop(0, css(rgb, 1));
    g.addColorStop(1, css(rgb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, s.y + 30);
    return;
  }
  ctx.fillStyle = css(rgb);
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(W, -2);
  for (let x = W; x >= 0; x -= 8) ctx.lineTo(x, edgeY(s, x));
  ctx.closePath();
  ctx.fill();
  for (const d of s.drips) {
    const top = edgeY(s, d.x) - 2;
    for (const x of [d.x - W, d.x, d.x + W]) {
      ctx.fillRect(x - d.w / 2, top, d.w, d.len);
      ctx.beginPath();
      ctx.arc(x, top + d.len, d.w / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Patterns are painted only where the layer already is ('source-atop'). */
function paintPattern(ctx: CanvasRenderingContext2D, layer: GlazeLayer, s: Shape, rand: () => number) {
  if (layer.pattern === 'plain') return;
  const rgb = hexRgb(layer.patternColour);
  const bottom = s.y + 140;
  ctx.globalCompositeOperation = 'source-atop';
  if (layer.pattern === 'speckle') {
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = css(rgb, 0.35 + rand() * 0.55);
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * bottom, 0.8 + rand() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (layer.pattern === 'dots') {
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = css(rgb, 0.85 + rand() * 0.15);
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * bottom, 1.5 + rand() * rand() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (layer.pattern === 'streaks') {
    // Runs of a second glaze trickling down.
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x = rand() * W;
      const y0 = rand() * bottom * 0.5;
      const len = 40 + rand() * 220;
      const w = 4 + rand() * 16;
      const sway = (rand() - 0.5) * 30;
      ctx.strokeStyle = ctx.fillStyle = css(rgb, 0.75 + rand() * 0.2);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.bezierCurveTo(x + sway, y0 + len * 0.35, x - sway, y0 + len * 0.7, x + sway * 0.3, y0 + len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + sway * 0.3, y0 + len, w * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** The body material: bare clay at the bottom, then each glaze layer painted on top. */
export function glazeMaterial(r: CharacterRecipe, seed: number): THREE.MeshPhysicalMaterial {
  const clayRand = mulberry32(seed);
  const colour = makeCanvas(W, H, (ctx) => {
    ctx.fillStyle = CLAY;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(120,90,60,${0.15 + clayRand() * 0.25})`;
      ctx.fillRect(clayRand() * W, clayRand() * H, 1.5, 1.5);
    }
  });
  const surface = makeCanvas(W, H, (ctx) => {
    ctx.fillStyle = css(unitRgb(SURFACE.clay));
    ctx.fillRect(0, 0, W, H);
  });
  const colourCtx = colour.getContext('2d')!;
  const surfaceCtx = surface.getContext('2d')!;

  r.layers.forEach((layer, i) => {
    const shape = layerShape(layer, layerBottom(r, i), mulberry32(seed + i * 101));
    const fade = layer.edge === 'fade';
    colourCtx.drawImage(
      makeCanvas(W, H, (ctx) => {
        fillRegion(ctx, shape, fade, hexRgb(layer.colour));
        paintPattern(ctx, layer, shape, mulberry32(seed + i * 7));
      }),
      0,
      0,
    );
    surfaceCtx.drawImage(makeCanvas(W, H, (ctx) => fillRegion(ctx, shape, fade, unitRgb(SURFACE[layer.finish]))), 0, 0);
  });

  const map = canvasTexture(colour, true);
  const orm = canvasTexture(surface, false);
  map.offset.x = orm.offset.x = 0.5; // texture seam at the back
  return glaze('#ffffff', {
    map,
    roughness: 1,
    roughnessMap: orm,
    metalness: 1,
    metalnessMap: orm,
    clearcoat: 1,
    clearcoatMap: orm,
    clearcoatRoughness: 0.1,
  });
}
