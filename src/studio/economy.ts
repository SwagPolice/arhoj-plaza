/*
 * The Studio economy as pure functions: a state goes in, a new state comes out, nothing else is touched.
 * Live play and time away run the same `advance`, so they can never disagree (time away just runs slower).
 * The numbers aim for a calm pace; tests/studio-economy.test.ts checks the pacing they give.
 */
import type { CharacterRecipe, Personality } from '../character/recipe';
import { CLAY_HEIGHT, defaultLayer, MAX_LAYERS, REACH, type Edge, type GlazeLayer } from '../character/recipe';
import { offshore, onEdge, placeNew, toEdge, toSea } from '../scene/layout';
import { mulberry32 } from '../util/random';
import { emptyPurse, MAX_GROUND, PRIMARIES, type Drop, type Purse, type StudioState } from './state';
import { MIXABLE, MIXABLE_ALL, mixResult } from './mixing';
import { hasTrait, LINGER, stepOf, stepVisit, type Item } from './merchant';
import { LIGHTHOUSE_COST, lighthouseOf, lighthouseUnlocked, unpack, waiting } from './lighthouse';
import { HARBOUR_COST, harbourOf, harbourUnlocked, stepTrip } from './harbour';
import { BOOST, fadeLifts, happiness } from './happiness';
import { stepStars, WHITE } from './stars';
import { levelOf, MIX_MAKES, WELL_EVERY } from './upgrades';
export { MIX_MAKES, WELL_EVERY };

/** Seconds between drops, and the chance a drop is double, by personality. */
export const RATES: Record<Personality, { every: number; double: number }> = {
  bouncy: { every: 16, double: 0 },
  calm: { every: 32, double: 0.25 },
  curious: { every: 22, double: 0 },
  shy: { every: 26, double: 0 },
};
/** How often a dipped character's drop is paint rather than clay, by how many glaze layers it has: more layers, more paint. */
export const PAINT_SHARE = [0, 0.1, 0.17, 0.24];
export const AWAY_CAP = 8 * 3600; // time away counts up to 8 hours
export const AWAY_MIN = 60; // shorter breaks just carry on
export const AWAY_SPEED = 1 / 3; // while you're away, the studio works at a third of its speed
export const TIDY_AWAY = 120; // drops a Tidy character picks up per hour while you're away (about two ghosts' worth)
export const MIX_TIME = 5; // seconds the bowl stirs
export const BOWL_COST = 40;

/** The Studio island's sizes (radius), and what each next one costs. */
export const ISLAND_SIZES = [5, 6, 7.5, 9, 11];
export const ISLAND_COSTS = [150, 400, 900, 2000];
/** Which size the island is at (worked out from its radius, so saves need nothing new). */
export const islandStep = (s: StudioState) => {
  const i = ISLAND_SIZES.findIndex((r) => r >= s.island.radius - 1e-6);
  return i < 0 ? ISLAND_SIZES.length - 1 : i;
};
/** The cost of the next size, or null once it's as big as it gets. */
export const islandCost = (s: StudioState): number | null => ISLAND_COSTS[islandStep(s)] ?? null;

/** Make the island a size bigger. Everything stays put, except the harbour, which moves out to the new edge (and the lighthouse's island, which keeps its distance). */
export function growIsland(s: StudioState): StudioState | null {
  const cost = islandCost(s);
  if (cost === null || s.purse.clay < cost) return null;
  const bigger = { ...s.island, radius: ISLAND_SIZES[islandStep(s) + 1] };
  bigger.items = bigger.items.map((d) => (offshore(d.kind) ? toSea(bigger, d) : onEdge(d.kind) ? toEdge(bigger, d) : d));
  return { ...s, purse: { ...s.purse, clay: s.purse.clay - cost }, island: bigger };
}

/** Each new ghost costs half as much again as the last (10, 15, 23, 34, 51…), so the studio grows slowly. */
export const ghostCost = (s: StudioState) => Math.round(10 * 1.5 ** (s.ghostsMade - 1));
/** Wells: 15, 60, 180, then three times the last each time. */
export const wellCost = (s: StudioState) => (s.wellsBuilt === 0 ? 15 : 60 * 3 ** (s.wellsBuilt - 1));

/**
 * One thing made: by whom (character, well or bowl id), what ('clay' or a paint colour), how much.
 * `back` marks paint the bowl gives back after a mix that made nothing new; `star` a shooting star's shard.
 */
export type Yield = { from: string; what: string; amount: number; back?: boolean; star?: boolean };

/** A mix the bowl just finished: the two paints, and what they made (null: nothing new, paints given back). */
export type Mixed = { a: string; b: string; made: string | null };

export const bowlOf = (s: StudioState) => s.island.items.find((d) => d.kind === 'bowl') ?? null;
/** You own a bowl if it's on the island or put away in storage (only one, either way). */
export const ownsBowl = (s: StudioState) => !!bowlOf(s) || s.storage.some((d) => d.kind === 'bowl');

/** The colours of a character's glaze layers, base first (it drops paint in any of them); empty when it's bare clay. */
export const layerColours = (r: CharacterRecipe) => r.layers.map((l) => l.colour);

/**
 * Let `seconds` pass: everyone and every well makes what it would have made in that time, the bowl stirs, and the
 * merchant comes and goes (bringing what was ordered from the lighthouse), and the boat sails on. `speed` slows the making down (time away), not the rest.
 * Characters away on the boat make nothing.
 */
export function advance(
  s: StudioState, seconds: number, speed = 1,
): {
  state: StudioState; yields: Yield[]; mixed: Mixed | null; visit: 'arrived' | 'left' | null; boatHome: boolean; stars: number;
  delivered: Item[]; // what he brought from the lighthouse, now in storage
} {
  const rand = mulberry32(s.seed);
  const progress = { ...s.progress };
  const wellTints = { ...s.wellTints };
  const yields: Yield[] = [];
  const dt = Math.max(0, seconds);
  const making = dt * speed;

  const atSea = new Set(s.harbour.trip?.crew ?? []);
  for (const c of s.characters) {
    if (atSea.has(c.id)) continue;
    const { every, double } = RATES[c.personality];
    const p = (progress[c.id] ?? rand() * every) + making * (1 + BOOST * happiness(s, c.id)); // happier: a bit faster // newcomers start part-way, so drops don't all land at once
    const n = Math.floor(p / every);
    progress[c.id] = p - n * every;
    const colours = layerColours(c);
    const share = PAINT_SHARE[Math.min(colours.length, PAINT_SHARE.length - 1)];
    for (let i = 0; i < n; i++) {
      if (colours.length && rand() < share) {
        // One layer: no second roll, so a single-dipped character plays out exactly as before layers.
        const colour = colours.length > 1 ? colours[Math.floor(rand() * colours.length)] : colours[0];
        yields.push({ from: c.id, what: colour, amount: 1 });
      } else yields.push({ from: c.id, what: 'clay', amount: rand() < double ? 2 : 1 });
    }
  }
  const primaries = Object.values(PRIMARIES);
  for (const w of s.island.items.filter((d) => d.kind === 'well')) {
    const p = (progress[w.id] ?? 0) + making;
    const every = WELL_EVERY[levelOf(s, w)]; // seconds per paint: quicker once upgraded
    const n = Math.floor(p / every);
    progress[w.id] = p - n * every;
    for (let i = 0; i < n; i++) {
      const colour = primaries[Math.floor(rand() * primaries.length)];
      yields.push({ from: w.id, what: colour, amount: 1 });
      wellTints[w.id] = colour;
    }
  }
  let { bowl, discovered } = s;
  let mixed: Mixed | null = null;
  if (bowl && bowl.left > dt) bowl = { ...bowl, left: bowl.left - dt };
  else if (bowl) {
    const from = bowlOf(s)?.id ?? 'bowl';
    const made = mixResult(bowl.a, bowl.b);
    if (made) {
      const batch = MIX_MAKES[bowlOf(s) ? levelOf(s, bowlOf(s)!) : 0]; // bigger batches once upgraded
      for (let i = 0; i < batch; i++) yields.push({ from, what: made, amount: 1 });
      if (!discovered.includes(made)) discovered = [...discovered, made];
    } else yields.push({ from, what: bowl.a, amount: 1, back: true }, { from, what: bowl.b, amount: 1, back: true });
    mixed = { a: bowl.a, b: bowl.b, made };
    bowl = null;
  }
  const { merchant, visit } = stepVisit(s.merchant, ownsBowl(s), stepOf(s), dt, rand);
  const { state: sailed, home } = stepTrip(s, dt, rand);
  const mood = fadeLifts(s.mood, dt);
  const fell = stepStars(s.stars, ownsBowl(s), dt, rand);
  for (const n of fell.shards) for (let i = 0; i < n; i++) yields.push({ from: 'star', what: WHITE, amount: 1, star: true });
  const stepped = { ...s, progress, wellTints, bowl, discovered, merchant, harbour: sailed.harbour, traits: sailed.traits, mood, stars: fell.stars };
  const { state, delivered } = unpack(stepped);
  return { state: { ...state, seed: Math.floor(rand() * 2 ** 31) }, yields, mixed, visit, boatHome: home, stars: fell.shards.length, delivered };
}

export function addTo(p: Purse, what: string, amount: number): Purse {
  if (what === 'clay') return { ...p, clay: p.clay + amount };
  return { ...p, paint: { ...p.paint, [what]: (p.paint[what] ?? 0) + amount } };
}

/** Things made, taken turn by turn from each maker (a ghost, a well…): close to the order they were made in. */
function takeTurns(yields: Yield[]): Yield[] {
  const byMaker = new Map<string, Yield[]>();
  for (const y of yields) byMaker.set(y.from, [...(byMaker.get(y.from) ?? []), y]);
  const queues = [...byMaker.values()];
  const out: Yield[] = [];
  for (let i = 0; out.length < yields.length; i++) for (const q of queues) if (q[i]) out.push(q[i]);
  return out;
}

const isEmpty = (p: Purse) => p.clay === 0 && Object.values(p.paint).every((n) => n === 0);

/**
 * Coming back after time away (or a reload), counted up to 8 hours; a clock that went backwards makes nothing,
 * and a short break just carries on. Meanwhile the studio worked at a third of its speed, and nobody collected:
 * - a mix that finished in the bowl goes into your purse (it was your doing);
 * - Tidy characters picked up to 120 drops an hour each, in the order things were made: that's the card;
 * - everything else is returned as `ground`, to lie on the island for you (as much as fits).
 */
export function comeBack(s: StudioState, now: number): { state: StudioState; seconds: number; ground: Yield[] } {
  const seconds = Math.min(AWAY_CAP, Math.max(0, (now - s.lastSeen) / 1000));
  if (seconds < AWAY_MIN) return { state: { ...s, lastSeen: now }, seconds: 0, ground: [] };
  const { state: later, yields } = advance(s, seconds, AWAY_SPEED);
  // If the merchant is about to leave as you come back, he lingers a little so you can still catch him.
  const m = later.merchant;
  const state = m.here && m.stay < LINGER ? { ...later, merchant: { ...m, stay: LINGER } } : later;
  const bowl = bowlOf(s)?.id ?? 'bowl';
  let purse = state.purse;
  for (const y of yields.filter((y) => y.from === bowl)) purse = addTo(purse, y.what, y.amount);
  const made = takeTurns(yields.filter((y) => y.from !== bowl));
  const tidy = s.characters.filter((c) => hasTrait(s, c.id, 'tidy')).length;
  const picked = Math.floor((tidy * TIDY_AWAY * seconds) / 3600);
  let away: Purse = s.away ? { clay: s.away.clay, paint: { ...s.away.paint } } : emptyPurse();
  for (const y of made.slice(0, picked)) away = addTo(away, y.what, y.amount);
  const card = isEmpty(away) ? s.away : { ...away, seconds: (s.away?.seconds ?? 0) + seconds };
  // What Tidy didn't get lies on the island: as much as fits, and every star shard (they wait outside the limit).
  const leftover = made.slice(picked);
  const room = Math.max(0, MAX_GROUND - s.ground.filter((d) => !d.star).length);
  const ground = [...leftover.filter((y) => !y.star).slice(0, room), ...leftover.filter((y) => y.star)];
  return { state: { ...state, purse, away: card, lastSeen: now }, seconds, ground };
}

export function collectAway(s: StudioState): StudioState {
  if (!s.away) return s;
  let purse = s.purse;
  purse = addTo(purse, 'clay', s.away.clay);
  for (const [c, n] of Object.entries(s.away.paint)) purse = addTo(purse, c, n);
  return { ...s, purse, away: null };
}

/**
 * Put fresh yields on the ground at (x, z) spots chosen by `spot`. The island holds at most 30 drops: when it's full,
 * nothing more is made until you collect (what older saves held back still comes out as you collect).
 */
export function dropOnGround(
  s: StudioState,
  yields: Yield[],
  spot: (y: Yield, i: number) => { x: number; z: number },
): { state: StudioState; dropped: { drop: Drop; index: number }[] } {
  const ground = [...s.ground];
  const dropped: { drop: Drop; index: number }[] = [];
  yields.forEach((y, i) => {
    if (y.star || ground.filter((g) => !g.star).length < MAX_GROUND) {
      const d: Drop = { id: `d${s.seed.toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`, ...spot(y, i), what: y.what, amount: y.amount };
      if (y.star) d.star = true;
      ground.push(d);
      dropped.push({ drop: d, index: i });
    }
  });
  return { state: { ...s, ground }, dropped };
}

/** Collect a drop: it goes into your purse. If anything was held back, one held thing comes out to replace it. */
export function collect(s: StudioState, dropId: string): { state: StudioState; got: Drop | null; release: Yield | null } {
  const got = s.ground.find((d) => d.id === dropId) ?? null;
  if (!got) return { state: s, got: null, release: null };
  let held = s.held;
  let release: Yield | null = null;
  if (held.clay > 0) {
    release = { from: 'held', what: 'clay', amount: 1 };
    held = { ...held, clay: held.clay - 1 };
  } else {
    const colour = Object.keys(held.paint).find((c) => held.paint[c] > 0);
    if (colour) {
      release = { from: 'held', what: colour, amount: 1 };
      held = { ...held, paint: { ...held.paint, [colour]: held.paint[colour] - 1 } };
    }
  }
  return { state: { ...s, purse: addTo(s.purse, got.what, got.amount), ground: s.ground.filter((d) => d !== got), held }, got, release };
}

// ---------- spending (never below zero: each returns null when you can't afford it) ----------

export function buyGhost(s: StudioState, ghost: CharacterRecipe): StudioState | null {
  const cost = ghostCost(s);
  if (s.purse.clay < cost) return null;
  return { ...s, purse: { ...s.purse, clay: s.purse.clay - cost }, characters: [...s.characters, ghost], ghostsMade: s.ghostsMade + 1 };
}

export function buyWell(s: StudioState): StudioState | null {
  const cost = wellCost(s);
  if (s.purse.clay < cost) return null;
  const well = placeNew(s.island, 'well');
  if (!well) return null; // no room on the island
  return {
    ...s,
    purse: { ...s.purse, clay: s.purse.clay - cost },
    island: { ...s.island, items: [...s.island.items, { ...well, size: 1 }] },
    wellsBuilt: s.wellsBuilt + 1,
  };
}

export function buyBowl(s: StudioState): StudioState | null {
  if (ownsBowl(s) || s.purse.clay < BOWL_COST) return null; // one bowl is enough
  const bowl = placeNew(s.island, 'bowl');
  if (!bowl) return null;
  return { ...s, purse: { ...s.purse, clay: s.purse.clay - BOWL_COST }, island: { ...s.island, items: [...s.island.items, bowl] } };
}

/** Put two paints (one of each; the same colour twice is fine) in the bowl to stir. */
export function startMix(s: StudioState, a: string, b: string): StudioState | null {
  if (!bowlOf(s) || s.bowl) return null;
  let paint = { ...s.purse.paint };
  for (const c of [a, b]) {
    if ((paint[c] ?? 0) < 1) return null;
    paint = { ...paint, [c]: paint[c] - 1 };
  }
  return { ...s, purse: { ...s.purse, paint }, bowl: { a, b, left: MIX_TIME } };
}

/** Dip a bare character in a paint you own (one dip per character for now). */
/** How a dip goes on: how far it reaches (0 to 1; on the first dip, how much of the foot it covers) and its edge. */
export type DipShape = { depth?: number; edge?: Edge };

/**
 * Dip a character in a paint you own (1 paint), over what it already has: up to 3 layers. The first dip covers
 * everything but the bare clay foot (deeper leaves less clay showing); later dips are taken from the top and
 * reach `depth` of the way down. Always glossy for now.
 */
export function dip(s: StudioState, characterId: string, colour: string, shape: DipShape = {}): StudioState | null {
  const c = s.characters.find((r) => r.id === characterId);
  if (!c || c.layers.length >= MAX_LAYERS || (s.purse.paint[colour] ?? 0) < 1) return null;
  const edge = shape.edge ?? 'clean';
  const first = !c.layers.length;
  const depth = shape.depth === undefined ? null : Math.min(1, Math.max(0, shape.depth));
  const layer: GlazeLayer = { ...defaultLayer(colour), edge, reach: first ? 0.5 : round2(depth === null ? 0.5 : REACH.min + depth * (REACH.max - REACH.min)) };
  const clayHeight = first && depth !== null ? round2(CLAY_HEIGHT.max - depth * (CLAY_HEIGHT.max - CLAY_HEIGHT.min)) : c.clayHeight;
  const dipped: CharacterRecipe = { ...c, clayHeight, layers: [...c.layers, layer] };
  return {
    ...s,
    purse: { ...s.purse, paint: { ...s.purse.paint, [colour]: s.purse.paint[colour] - 1 } },
    characters: s.characters.map((r) => (r.id === characterId ? dipped : r)),
  };
}

/** Scrape the top glaze layer off: free, but its paint isn't given back. Null if it's bare clay. */
export function scrape(s: StudioState, characterId: string): StudioState | null {
  const c = s.characters.find((r) => r.id === characterId);
  if (!c?.layers.length) return null;
  return { ...s, characters: s.characters.map((r) => (r === c ? { ...r, layers: r.layers.slice(0, -1) } : r)) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The one next thing to aim for, always shown. */
export function nextGoal(s: StudioState): string {
  const more = (n: number) => `${n} more clay`;
  const paints = Object.values(s.purse.paint).reduce((n, k) => n + k, 0);
  // Things that won't wait come first.
  if (s.merchant.here) return 'The merchant is here: tap him';
  if (s.harbour.haul) return 'The boat is back: tap the harbour';
  const ordered = waiting(s);
  if (ordered) return `He brought your ${ordered.name.toLowerCase()}: tap the lighthouse`;
  if (!s.wellsBuilt) {
    const cost = wellCost(s);
    return s.purse.clay >= cost ? 'Next: build your first glaze well!' : `Next: Glaze well, ${more(cost - s.purse.clay)}`;
  }
  const bare = s.characters.some((c) => !c.layers.length);
  const anyDipped = s.characters.some((c) => c.layers.length);
  if (bare && paints && !anyDipped) return 'Next: tap a ghost and dip it in paint';
  if (!anyDipped) return 'Next: collect a paint drop from the well';
  if (!ownsBowl(s)) {
    return s.purse.clay >= BOWL_COST ? 'Next: build the mixing bowl!' : `Next: Mixing bowl, ${more(BOWL_COST - s.purse.clay)}`;
  }
  if (s.bowl) return 'The bowl is stirring…';
  if (!s.discovered.length) return paints >= 2 ? 'Next: tap the bowl and mix two paints' : 'Next: collect two paints to mix';
  if (harbourUnlocked(s) && !harbourOf(s)) {
    return s.purse.clay >= HARBOUR_COST ? 'Next: build the harbour!' : `Next: Harbour, ${more(HARBOUR_COST - s.purse.clay)}`;
  }
  const mixable = s.stars.seen ? MIXABLE_ALL : MIXABLE; // white (from the stars) opens the pastels
  const found = mixable.filter((c) => s.discovered.includes(c)).length;
  if (found < mixable.length && paints >= 2) return `Next: mix a new colour (${found} of ${mixable.length} found)`;
  if (bare && paints) return 'Next: tap a ghost and dip it in paint';
  if (lighthouseUnlocked(s) && !lighthouseOf(s)) {
    return s.purse.clay >= LIGHTHOUSE_COST ? 'Next: build the lighthouse!' : `Next: Lighthouse, ${more(LIGHTHOUSE_COST - s.purse.clay)}`;
  }
  // Once the island is getting full of characters, room comes before more of them.
  const grow = islandCost(s);
  if (grow !== null && s.characters.length >= 4) {
    return s.purse.clay >= grow ? 'Next: make the island bigger!' : `Next: Bigger island, ${more(grow - s.purse.clay)}`;
  }
  const cost = ghostCost(s);
  return s.purse.clay >= cost ? 'Next: make a new ghost!' : `Next: another ghost, ${more(cost - s.purse.clay)}`;
}
