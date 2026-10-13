import { GLAZES, METALS } from './palette';
import { between, pick } from '../util/random';

export const BODIES = ['ghost', 'cone', 'bell', 'bean', 'blob'] as const;
export const FINISHES = ['glossy', 'satin', 'metallic'] as const;
export const PATTERNS = ['plain', 'speckle', 'dots', 'streaks'] as const;
export const EDGES = ['clean', 'wavy', 'drips', 'fade'] as const;
export const EYES = ['open', 'tired', 'sleepy', 'happy', 'crossed'] as const;
export const MOUTHS = ['none', 'red'] as const;
export const PERSONALITIES = ['calm', 'curious', 'shy', 'bouncy'] as const;

export type Body = (typeof BODIES)[number];
export type Finish = (typeof FINISHES)[number];
export type Pattern = (typeof PATTERNS)[number];
export type Edge = (typeof EDGES)[number];
export type Eyes = (typeof EYES)[number];
export type Mouth = (typeof MOUTHS)[number];
export type Personality = (typeof PERSONALITIES)[number];

export const HEIGHT = { min: 0.8, max: 1.4 };
export const WIDTH = { min: 0.75, max: 1.3 };
export const CLAY_HEIGHT = { min: 0.04, max: 0.4 };
export const REACH = { min: 0.1, max: 1 };
export const EYE_HEIGHT = { min: 0, max: 1 };
export const EYE_SIZE = { min: 0.7, max: 1.5 };
export const EYE_SPACING = { min: 0, max: 1 }; // 0 = touching, 1 = 45° apart
export const MAX_LAYERS = 3;

/**
 * One dip of glaze. The first layer covers everything above the bare clay;
 * later layers are dipped from the top and cover `reach` of the glazed height.
 */
export type GlazeLayer = {
  colour: string;
  finish: Finish;
  pattern: Pattern;
  patternColour: string;
  edge: Edge;
  reach: number;
};

/** Everything needed to rebuild a character. Small, plain JSON so it's easy to save and share. */
export type CharacterRecipe = {
  id: string;
  name: string;
  body: Body;
  height: number;
  width: number;
  clayHeight: number;
  layers: GlazeLayer[];
  eyes: Eyes;
  eyeHeight: number;
  eyeSize: number;
  eyeSpacing: number;
  mouth: Mouth;
  personality: Personality;
};

const NAMES = [
  'Mochi', 'Pip', 'Bolle', 'Knud', 'Tofu', 'Lune', 'Fika', 'Nuppe', 'Bao', 'Pebble',
  'Kiki', 'Olu', 'Hygge', 'Momo', 'Sprout', 'Taffy', 'Dumle', 'Ingo', 'Plum', 'Smørre',
  'Bean', 'Toots', 'Miso', 'Frida', 'Klump', 'Yuzu', 'Pölse', 'Nugget', 'Lakrids', 'Bun',
];

export const randomName = () => pick(NAMES);

export function newId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const isMetal = (hex: string) => METALS.some((m) => m.hex === hex.toLowerCase());

export function defaultLayer(colour = '#a9e0c8'): GlazeLayer {
  return { colour, finish: 'glossy', pattern: 'plain', patternColour: '#fffdf8', edge: 'clean', reach: 0.5 };
}

export function defaultRecipe(): CharacterRecipe {
  return {
    id: newId(),
    name: randomName(),
    body: 'ghost',
    height: 1,
    width: 1,
    clayHeight: 0.2,
    layers: [defaultLayer()],
    eyes: 'open',
    eyeHeight: 0.55,
    eyeSize: 1,
    eyeSpacing: 0.15,
    mouth: 'none',
    personality: 'calm',
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const weighted = <T>(options: [T, number][]): T => {
  let roll = Math.random() * options.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of options) if ((roll -= w) <= 0) return v;
  return options[0][0];
};

export function randomLayer(isBase: boolean): GlazeLayer {
  if (!isBase && Math.random() < 0.12) {
    return { ...defaultLayer(pick(METALS).hex), finish: 'metallic', edge: pick(['clean', 'wavy'] as const), reach: round2(between(0.3, 0.75)) };
  }
  const pattern = weighted<Pattern>([['plain', 45], ['speckle', 25], ['dots', 15], ['streaks', 15]]);
  return {
    colour: pick(GLAZES).hex,
    finish: weighted<Finish>([['glossy', 80], ['satin', 20]]),
    pattern,
    patternColour: pattern === 'dots' ? '#f7f4ee' : pattern === 'speckle' ? '#24232a' : pick(GLAZES).hex,
    edge: isBase ? weighted<Edge>([['clean', 60], ['wavy', 25], ['drips', 15]]) : weighted<Edge>([['clean', 30], ['drips', 35], ['fade', 20], ['wavy', 15]]),
    reach: round2(between(0.25, 0.8)),
  };
}

/** New look and personality, same id and name. */
export function randomLooks(r: CharacterRecipe): CharacterRecipe {
  const layers = [randomLayer(true)];
  if (Math.random() < 0.7) layers.push(randomLayer(false));
  if (Math.random() < 0.25) layers.push({ ...randomLayer(false), reach: round2(between(0.1, 0.35)) });
  return {
    ...r,
    body: weighted<Body>([['ghost', 60], ['cone', 10], ['bell', 10], ['bean', 10], ['blob', 10]]),
    height: round2(between(HEIGHT.min, HEIGHT.max)),
    width: round2(between(WIDTH.min, WIDTH.max)),
    clayHeight: round2(between(0.12, 0.3)),
    layers,
    eyes: weighted<Eyes>([['open', 55], ['tired', 15], ['sleepy', 10], ['happy', 10], ['crossed', 10]]),
    eyeHeight: round2(between(0.1, 0.95)),
    eyeSize: round2(between(0.8, 1.3)),
    eyeSpacing: round2(between(0, 0.5)),
    mouth: weighted<Mouth>([['none', 85], ['red', 15]]),
    personality: pick(PERSONALITIES),
  };
}

export const randomRecipe = () => randomLooks(defaultRecipe());

// ---------- loading saved data ----------

const oneOf = <T extends string>(xs: readonly T[], v: unknown, fb: T): T =>
  (xs as readonly unknown[]).includes(v) ? (v as T) : fb;
const num = (v: unknown, range: { min: number; max: number }, fb: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : fb;
const colour = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fb);

function normaliseLayer(raw: unknown): GlazeLayer {
  const d = defaultLayer();
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    colour: colour(o.colour, d.colour),
    finish: oneOf(FINISHES, o.finish, d.finish),
    pattern: oneOf(PATTERNS, o.pattern, d.pattern),
    patternColour: colour(o.patternColour, d.patternColour),
    edge: oneOf(EDGES, o.edge, d.edge),
    reach: num(o.reach, REACH, d.reach),
  };
}

// Eye styles from earlier versions, mapped to their closest Arhoj-style replacement.
const OLD_EYES: Record<string, Eyes> = { ring: 'open', dots: 'open', wide: 'open', closed: 'happy' };

/** Turn anything loaded from storage into a valid recipe, filling gaps with defaults. */
export function normaliseRecipe(raw: unknown): CharacterRecipe {
  const d = defaultRecipe();
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let layers = Array.isArray(o.layers) ? o.layers.slice(0, MAX_LAYERS).map(normaliseLayer) : [];
  if (!layers.length) {
    // Characters saved before glaze layers existed.
    layers = [{
      ...defaultLayer(colour(o.glaze, d.layers[0].colour)),
      pattern: o.glazeFinish === 'speckled' ? 'speckle' : 'plain',
      patternColour: '#24232a',
      edge: o.glazeFinish === 'drip' ? 'drips' : 'clean',
    }];
  }
  return {
    id: typeof o.id === 'string' && o.id ? o.id : d.id,
    name: typeof o.name === 'string' ? o.name.slice(0, 18) : d.name,
    body: oneOf(BODIES, o.body, d.body), // old mushrooms become ghosts
    height: num(o.height, HEIGHT, d.height),
    width: num(o.width, WIDTH, d.width),
    clayHeight: num(o.clayHeight, CLAY_HEIGHT, d.clayHeight),
    layers,
    eyes: oneOf(EYES, OLD_EYES[String(o.eyes)] ?? o.eyes, d.eyes),
    eyeHeight: num(o.eyeHeight, EYE_HEIGHT, d.eyeHeight),
    eyeSize: num(o.eyeSize, EYE_SIZE, d.eyeSize),
    eyeSpacing: num(o.eyeSpacing, EYE_SPACING, d.eyeSpacing),
    mouth: oneOf(MOUTHS, o.mouth, d.mouth), // older cartoon mouths become 'none'
    personality: oneOf(PERSONALITIES, o.personality, d.personality),
  };
}
