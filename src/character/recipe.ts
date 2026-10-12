import { GLAZES } from './palette';
import { between, pick } from '../util/random';

export const BODIES = ['cone', 'mushroom', 'ghost', 'bean', 'bell'] as const;
export const FINISHES = ['glossy', 'speckled', 'drip'] as const;
export const TOPPERS = ['none', 'cap', 'spots', 'leaf', 'tiny-hat'] as const;
export const EYES = ['dots', 'wide', 'closed', 'sleepy'] as const;
export const MOUTHS = ['none', 'smile', 'o', 'cat'] as const;
export const PERSONALITIES = ['calm', 'curious', 'shy', 'bouncy'] as const;

export type Body = (typeof BODIES)[number];
export type Finish = (typeof FINISHES)[number];
export type Topper = (typeof TOPPERS)[number];
export type Eyes = (typeof EYES)[number];
export type Mouth = (typeof MOUTHS)[number];
export type Personality = (typeof PERSONALITIES)[number];

export const HEIGHT = { min: 0.8, max: 1.4 };
export const WIDTH = { min: 0.75, max: 1.3 };

/** Everything needed to rebuild a character. Small, plain JSON so it's easy to save and share. */
export type CharacterRecipe = {
  id: string;
  name: string;
  body: Body;
  height: number;
  width: number;
  glaze: string;
  glazeFinish: Finish;
  topper: Topper;
  topperColour: string;
  eyes: Eyes;
  mouth: Mouth;
  cheeks: boolean;
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

export function defaultRecipe(): CharacterRecipe {
  return {
    id: newId(),
    name: randomName(),
    body: 'cone',
    height: 1,
    width: 1,
    glaze: '#efe5d0',
    glazeFinish: 'speckled',
    topper: 'none',
    topperColour: '#ec8a6a',
    eyes: 'dots',
    mouth: 'smile',
    cheeks: true,
    personality: 'calm',
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** New look and personality, same id and name. */
export function randomLooks(r: CharacterRecipe): CharacterRecipe {
  const glaze = pick(GLAZES).hex;
  let accent = pick(GLAZES).hex;
  while (accent === glaze) accent = pick(GLAZES).hex;
  return {
    ...r,
    body: pick(BODIES),
    height: round2(between(HEIGHT.min, HEIGHT.max)),
    width: round2(between(WIDTH.min, WIDTH.max)),
    glaze,
    glazeFinish: pick(FINISHES),
    topper: pick(TOPPERS),
    topperColour: accent,
    eyes: pick(EYES),
    mouth: pick(MOUTHS),
    cheeks: Math.random() < 0.6,
    personality: pick(PERSONALITIES),
  };
}

export const randomRecipe = () => randomLooks(defaultRecipe());

/** Turn anything loaded from storage into a valid recipe, filling gaps with defaults. */
export function normaliseRecipe(raw: unknown): CharacterRecipe {
  const d = defaultRecipe();
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const oneOf = <T extends string>(xs: readonly T[], v: unknown, fb: T): T =>
    (xs as readonly unknown[]).includes(v) ? (v as T) : fb;
  const num = (v: unknown, lo: number, hi: number, fb: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
  const colour = (v: unknown, fb: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fb);
  return {
    id: typeof o.id === 'string' && o.id ? o.id : d.id,
    name: typeof o.name === 'string' ? o.name.slice(0, 18) : d.name,
    body: oneOf(BODIES, o.body, d.body),
    height: num(o.height, HEIGHT.min, HEIGHT.max, d.height),
    width: num(o.width, WIDTH.min, WIDTH.max, d.width),
    glaze: colour(o.glaze, d.glaze),
    glazeFinish: oneOf(FINISHES, o.glazeFinish, d.glazeFinish),
    topper: oneOf(TOPPERS, o.topper, d.topper),
    topperColour: colour(o.topperColour, d.topperColour),
    eyes: oneOf(EYES, o.eyes, d.eyes),
    mouth: oneOf(MOUTHS, o.mouth, d.mouth),
    cheeks: typeof o.cheeks === 'boolean' ? o.cheeks : d.cheeks,
    personality: oneOf(PERSONALITIES, o.personality, d.personality),
  };
}
