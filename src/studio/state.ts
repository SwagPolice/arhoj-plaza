/*
 * Studio Mode's save: its own characters and island, what you've collected, and what's waiting.
 * Same safety rules as recipes and islands (see src/character/recipe.ts): defaults for new fields,
 * never rename what shipped, bump STUDIO_VERSION with a migration for changed meanings.
 * tests/studio-state.test.ts keeps a frozen save loading.
 */
import { defaultRecipe, EYES, normaliseRecipe, PERSONALITIES, randomName, type CharacterRecipe } from '../character/recipe';
import { normaliseLayout, type IslandLayout } from '../scene/layout';
import { pick } from '../util/random';

export const STUDIO_VERSION = 1;

/** The three colours a glaze well makes; everything else will be mixed from these. */
export const PRIMARIES = { red: '#d8382f', yellow: '#f2c230', cobalt: '#2f55b5' } as const;

/** What you own (or what's waiting for you): clay, plus paint by colour. */
export type Purse = { clay: number; paint: Record<string, number> };
/** Something lying on the ground, waiting to be tapped: `what` is 'clay' or a paint colour. */
export type Drop = { id: string; x: number; z: number; what: string; amount: number };

/** Two paints stirring in the mixing bowl, and the seconds left until they're mixed. */
export type Mix = { a: string; b: string; left: number };

export type StudioState = {
  characters: CharacterRecipe[]; // bare ghosts have no glaze layers yet
  island: IslandLayout; // glaze wells live here
  purse: Purse;
  ghostsMade: number; // including the first one
  wellsBuilt: number;
  progress: Record<string, number>; // seconds towards the next drop, per character or well
  ground: Drop[]; // at most MAX_GROUND
  held: Purse; // made while the ground was full; released as drops get collected, never lost
  away: (Purse & { seconds: number }) | null; // the "While you were away" card, until collected
  wellTints: Record<string, string>; // each well's water: the last colour it made
  bowl: Mix | null; // what the mixing bowl is stirring, if anything (added after v1 shipped: missing = null)
  discovered: string[]; // colours made in the bowl so far (added after v1 shipped: missing = [])
  firsts: string[]; // first times already celebrated ('paint', 'well', 'dip', 'bowl', 'mix')
  lastSeen: number; // ms since 1970
  seed: number; // the random rolls follow from this, so the same save always plays out the same
};

export const emptyPurse = (): Purse => ({ clay: 0, paint: {} });

/** A bare clay ghost: no glaze yet, everything else picked at random (or by you). */
export function bareGhost(over: Partial<CharacterRecipe> = {}): CharacterRecipe {
  return { ...defaultRecipe(), body: 'ghost', layers: [], eyes: pick(EYES), personality: pick(PERSONALITIES), name: randomName(), ...over };
}

export function newStudio(now = Date.now()): StudioState {
  return {
    characters: [bareGhost()],
    island: { radius: 5, items: [] },
    purse: emptyPurse(),
    ghostsMade: 1,
    wellsBuilt: 0,
    progress: {},
    ground: [],
    held: emptyPurse(),
    away: null,
    wellTints: {},
    bowl: null,
    discovered: [],
    firsts: [],
    lastSeen: now,
    seed: Math.floor(Math.random() * 2 ** 31),
  };
}

// ---------- loading saved data ----------

type Raw = Record<string, unknown>;

// MIGRATIONS[n] upgrades version n data to n + 1. Studio saves started at version 1.
const MIGRATIONS: Record<number, (o: Raw) => Raw> = {};

function upgrade(o: Raw): Raw {
  let v = typeof o.v === 'number' ? o.v : STUDIO_VERSION;
  let data = o;
  while (v < STUDIO_VERSION) data = MIGRATIONS[v++](data);
  return data;
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown, fb = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fb);
const whole = (v: unknown, fb: number, min = 0) => Math.max(min, Math.floor(count(v, fb)));
const isHex = (k: string) => /^#[0-9a-f]{6}$/i.test(k);

function normalisePurse(raw: unknown): Purse {
  const o = isObj(raw) ? raw : {};
  const paint: Record<string, number> = {};
  if (isObj(o.paint)) for (const [k, v] of Object.entries(o.paint)) if (isHex(k) && count(v) > 0) paint[k.toLowerCase()] = whole(v, 0);
  return { clay: whole(o.clay, 0), paint };
}

export const MAX_GROUND = 30;

/** Turn anything loaded from storage into a valid studio. Nothing useful → a fresh start. */
export function normaliseStudio(raw: unknown, now = Date.now()): StudioState {
  if (!isObj(raw)) return newStudio(now);
  const o = upgrade(raw);
  const fresh = newStudio(now);

  const characters: CharacterRecipe[] = [];
  for (const r of Array.isArray(o.characters) ? o.characters : []) {
    const recipe = normaliseRecipe(r);
    if (!characters.some((c) => c.id === recipe.id)) characters.push(recipe);
  }
  const ground: Drop[] = [];
  for (const d of Array.isArray(o.ground) ? o.ground : []) {
    if (!isObj(d) || ground.length >= MAX_GROUND) continue;
    const what = d.what === 'clay' || (typeof d.what === 'string' && isHex(d.what)) ? (d.what as string) : null;
    if (!what || typeof d.id !== 'string') continue;
    ground.push({ id: d.id, x: Number(d.x) || 0, z: Number(d.z) || 0, what: what.toLowerCase(), amount: whole(d.amount, 1, 1) });
  }
  const progress: Record<string, number> = {};
  if (isObj(o.progress)) for (const [k, v] of Object.entries(o.progress)) progress[k] = count(v);
  const wellTints: Record<string, string> = {};
  if (isObj(o.wellTints)) for (const [k, v] of Object.entries(o.wellTints)) if (typeof v === 'string' && isHex(v)) wellTints[k] = v.toLowerCase();
  const bowl =
    isObj(o.bowl) && typeof o.bowl.a === 'string' && isHex(o.bowl.a) && typeof o.bowl.b === 'string' && isHex(o.bowl.b)
      ? { a: o.bowl.a.toLowerCase(), b: o.bowl.b.toLowerCase(), left: count(o.bowl.left) }
      : null;
  const discovered = Array.isArray(o.discovered) ? [...new Set(o.discovered.filter((c): c is string => typeof c === 'string' && isHex(c)).map((c) => c.toLowerCase()))] : [];
  const away = isObj(o.away) ? { ...normalisePurse(o.away), seconds: count(o.away.seconds) } : null;

  return {
    characters: characters.length ? characters : fresh.characters, // a studio always has someone in it
    island: isObj(o.island) ? normaliseLayout(o.island) : fresh.island,
    purse: normalisePurse(o.purse),
    ghostsMade: whole(o.ghostsMade, characters.length || 1, 1),
    wellsBuilt: whole(o.wellsBuilt, 0),
    progress,
    ground,
    held: normalisePurse(o.held),
    away,
    wellTints,
    bowl,
    discovered,
    firsts: Array.isArray(o.firsts) ? o.firsts.filter((f): f is string => typeof f === 'string') : [],
    lastSeen: typeof o.lastSeen === 'number' && Number.isFinite(o.lastSeen) ? o.lastSeen : now,
    seed: typeof o.seed === 'number' && Number.isFinite(o.seed) ? Math.floor(o.seed) : fresh.seed,
  };
}

/** The save as stored: tagged with its version. */
export const studioData = (s: StudioState) => ({ v: STUDIO_VERSION, ...s });

export const isFromNewerStudio = (raw: unknown) => isObj(raw) && typeof raw.v === 'number' && raw.v > STUDIO_VERSION;
