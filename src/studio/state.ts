/*
 * Studio Mode's save: its own characters and island, what you've collected, and what's waiting.
 * Same safety rules as recipes and islands (see src/character/recipe.ts): defaults for new fields,
 * never rename what shipped, bump STUDIO_VERSION with a migration for changed meanings.
 * tests/studio-state.test.ts keeps a frozen save loading.
 */
import { defaultRecipe, EYES, normaliseRecipe, PERSONALITIES, randomName, type CharacterRecipe } from '../character/recipe';
import { DECOR_KINDS, normaliseLayout, type DecorKind, type IslandLayout } from '../scene/layout';
import { pick } from '../util/random';
import { FIRST_STAR, newStars, type Stars } from './stars';

export const STUDIO_VERSION = 1;

/** The three colours a glaze well makes; everything else will be mixed from these. */
export const PRIMARIES = { red: '#d8382f', yellow: '#f2c230', cobalt: '#2f55b5' } as const;

/** What you own (or what's waiting for you): clay, plus paint by colour. */
export type Purse = { clay: number; paint: Record<string, number> };
/** Something lying on the ground, waiting to be collected (hovered over, or tapped on touch screens): `what` is 'clay' or a paint colour. */
export type Drop = { id: string; x: number; z: number; what: string; amount: number; star?: boolean }; // star: a shard, outside the limit

/** Traits a Studio character can gain on top of its personality (kept here, not in the recipe, so share codes stay the same). */
export const TRAITS = ['tidy', 'seafarer'] as const;
export type Trait = (typeof TRAITS)[number];

/** One thing in his basket this visit, and how many he has left. */
export type Offer = { id: string; left: number };
/**
 * The balloon merchant: whether he's here, seconds until he comes or until he goes, clay paid to him so far,
 * and what he brought this visit (null until it's packed: on arrival, or for saves from before baskets).
 */
export type Merchant = { here: boolean; wait: number; stay: number; paid: number; visits: number; offers: Offer[] | null };
export const FIRST_VISIT = 20; // seconds after the mixing bowl is built

/** One thing an expedition brought back, and who found it. `what` is 'clay', a paint colour, or a decoration kind. */
export type Find = { who: string; what: string; amount: number };
/**
 * The harbour: its boat (level 1 = the bigger boat), the trip at sea if any (seconds left), what's waiting in the
 * crate, and how many trips each character has made (three make a Seafarer).
 */
export type Harbour = {
  level: number;
  trip: { to: string; crew: string[]; left: number } | null;
  haul: { to: string; finds: Find[] } | null;
  trips: Record<string, number>;
};
export const newHarbour = (): Harbour => ({ level: 0, trip: null, haul: null, trips: {} });

/**
 * How a character feels: comfort (from the island around it, eased in), lift (from chats and taps, fading),
 * and when it was last tapped (ms), so taps can't be farmed.
 */
export type Mood = { comfort: number; lift: number; petted: number };

/** A decoration (or a well or the bowl) put away: off the island, keeping its id, size and turn. */
export type Stored = { id: string; kind: DecorKind; size: number; rot: number; colour?: string };

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
  merchant: Merchant; // (added after v1 shipped: missing = not met yet)
  traits: Record<string, Trait[]>; // by character id (added after v1 shipped: missing = none)
  harbour: Harbour; // (added after v1 shipped: missing = a harbour-to-be, nothing at sea)
  storage: Stored[]; // things put away, in the order they went in (added after v1 shipped: missing = empty)
  mood: Record<string, Mood>; // by character id (added after v1 shipped: missing = neutral)
  friends: Record<string, number>; // friendship 0–1 by pair, 'idA|idB' sorted (added after v1 shipped: missing = none)
  stars: Stars; // the next shooting star (added after v1 shipped: missing = none seen yet)
  book: { found: string[]; rewards: number }; // the palette book: colours found, rewards handed out (added later: missing = empty)
  firsts: string[]; // first times already celebrated ('paint', 'well', 'dip', 'bowl', 'mix')
  lastSeen: number; // ms since 1970
  seed: number; // the random rolls follow from this, so the same save always plays out the same
};

export const emptyPurse = (): Purse => ({ clay: 0, paint: {} });
const newMerchant = (): Merchant => ({ here: false, wait: FIRST_VISIT, stay: 0, paid: 0, visits: 0, offers: null });

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
    merchant: newMerchant(),
    traits: {},
    harbour: newHarbour(),
    storage: [],
    mood: {},
    friends: {},
    stars: newStars(),
    book: { found: [], rewards: 0 },
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
    if (!isObj(d)) continue;
    const star = d.star === true; // star shards wait outside the 30-drop limit
    if (!star && ground.filter((g) => !g.star).length >= MAX_GROUND) continue;
    const what = d.what === 'clay' || (typeof d.what === 'string' && isHex(d.what)) ? (d.what as string) : null;
    if (!what || typeof d.id !== 'string') continue;
    const drop: Drop = { id: d.id, x: Number(d.x) || 0, z: Number(d.z) || 0, what: what.toLowerCase(), amount: whole(d.amount, 1, 1) };
    ground.push(star ? { ...drop, star } : drop);
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
  const m = isObj(o.merchant) ? o.merchant : {};
  const merchant: Merchant = {
    here: m.here === true,
    wait: count(m.wait, FIRST_VISIT),
    stay: count(m.stay),
    paid: whole(m.paid, 0),
    visits: whole(m.visits, 0),
    offers: Array.isArray(m.offers)
      ? m.offers.filter(isObj).filter((x) => typeof x.id === 'string').map((x) => ({ id: x.id as string, left: whole(x.left, 0) }))
      : null,
  };
  const ids = new Set(characters.map((c) => c.id));
  const traits: Record<string, Trait[]> = {};
  if (isObj(o.traits))
    for (const [id, list] of Object.entries(o.traits)) {
      const known = Array.isArray(list) ? [...new Set(list.filter((t): t is Trait => TRAITS.includes(t as Trait)))] : [];
      if (ids.has(id) && known.length) traits[id] = known;
    }
  const h = isObj(o.harbour) ? o.harbour : {};
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const trip = isObj(h.trip) && typeof h.trip.to === 'string' && strings(h.trip.crew).length
    ? { to: h.trip.to, crew: strings(h.trip.crew), left: count(h.trip.left) }
    : null;
  const finds: Find[] = [];
  if (isObj(h.haul)) for (const f of Array.isArray(h.haul.finds) ? h.haul.finds : []) {
    if (isObj(f) && typeof f.who === 'string' && typeof f.what === 'string') finds.push({ who: f.who, what: f.what, amount: whole(f.amount, 1, 1) });
  }
  const trips: Record<string, number> = {};
  if (isObj(h.trips)) for (const [id, n] of Object.entries(h.trips)) if (whole(n, 0)) trips[id] = whole(n, 0);
  const harbour: Harbour = {
    level: whole(h.level, 0),
    trip,
    haul: isObj(h.haul) && typeof h.haul.to === 'string' && finds.length ? { to: h.haul.to, finds } : null,
    trips,
  };
  const island = isObj(o.island) ? normaliseLayout(o.island) : fresh.island;
  const taken = new Set(island.items.map((d) => d.id));
  const storage: Stored[] = [];
  for (const d of Array.isArray(o.storage) ? o.storage : []) {
    if (!isObj(d) || typeof d.id !== 'string' || taken.has(d.id)) continue;
    const kind = d.kind as DecorKind;
    if (!(DECOR_KINDS as readonly string[]).includes(kind) || kind === 'harbour') continue; // the harbour stays on its edge
    taken.add(d.id);
    const thing: Stored = { id: d.id, kind, size: count(d.size, 1) || 1, rot: count(d.rot) };
    if (typeof d.colour === 'string' && isHex(d.colour)) thing.colour = d.colour.toLowerCase();
    storage.push(thing);
  }
  const unit = (v: unknown) => Math.min(1, count(v));
  const mood: Record<string, Mood> = {};
  if (isObj(o.mood))
    for (const [id, m] of Object.entries(o.mood)) {
      if (ids.has(id) && isObj(m)) mood[id] = { comfort: unit(m.comfort), lift: unit(m.lift), petted: count(m.petted) };
    }
  const friends: Record<string, number> = {};
  if (isObj(o.friends))
    for (const [pair, v] of Object.entries(o.friends)) {
      const [a, b, extra] = pair.split('|');
      if (extra === undefined && a && b && a < b && ids.has(a) && ids.has(b) && unit(v) > 0) friends[pair] = unit(v);
    }
  const bk = isObj(o.book) ? o.book : {};
  const book = {
    found: Array.isArray(bk.found) ? [...new Set(bk.found.filter((c): c is string => typeof c === 'string' && isHex(c)).map((c) => c.toLowerCase()))] : [],
    rewards: whole(bk.rewards, 0),
  };
  const st = isObj(o.stars) ? o.stars : {};
  const stars: Stars = { wait: count(st.wait, FIRST_STAR), seen: whole(st.seen, 0) };
  const away = isObj(o.away) ? { ...normalisePurse(o.away), seconds: count(o.away.seconds) } : null;

  return {
    characters: characters.length ? characters : fresh.characters, // a studio always has someone in it
    island,
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
    merchant,
    traits,
    harbour,
    storage,
    mood,
    friends,
    stars,
    book,
    firsts: Array.isArray(o.firsts) ? o.firsts.filter((f): f is string => typeof f === 'string') : [],
    lastSeen: typeof o.lastSeen === 'number' && Number.isFinite(o.lastSeen) ? o.lastSeen : now,
    seed: typeof o.seed === 'number' && Number.isFinite(o.seed) ? Math.floor(o.seed) : fresh.seed,
  };
}

/** The save as stored: tagged with its version. */
export const studioData = (s: StudioState) => ({ v: STUDIO_VERSION, ...s });

export const isFromNewerStudio = (raw: unknown) => isObj(raw) && typeof raw.v === 'number' && raw.v > STUDIO_VERSION;
