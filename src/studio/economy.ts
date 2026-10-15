/*
 * The Studio economy as pure functions: a state goes in, a new state comes out, nothing else is touched.
 * Live play and time away run the same `advance`, so they can never disagree.
 * All numbers here are first guesses; tests/studio-economy.test.ts checks the pacing they give.
 */
import type { CharacterRecipe, Personality } from '../character/recipe';
import { defaultLayer } from '../character/recipe';
import { placeNew } from '../scene/layout';
import { mulberry32 } from '../util/random';
import { emptyPurse, MAX_GROUND, PRIMARIES, type Drop, type Purse, type StudioState } from './state';
import { MIXABLE, mixResult } from './mixing';

/** Seconds between drops, and the chance a drop is double, by personality. */
export const RATES: Record<Personality, { every: number; double: number }> = {
  bouncy: { every: 8, double: 0 },
  calm: { every: 17, double: 0.25 },
  curious: { every: 12, double: 0 },
  shy: { every: 14, double: 0 },
};
export const PAINT_SHARE = 0.3; // a dipped character's drop is paint this often
export const WELL_EVERY = 60; // seconds per paint from a glaze well
export const AWAY_CAP = 8 * 3600; // time away counts up to 8 hours
export const AWAY_MIN = 60; // shorter breaks just carry on, no card
export const MIX_TIME = 5; // seconds the bowl stirs
export const MIX_MAKES = 2; // drops of the new colour from one mix
export const BOWL_COST = 40;

export const ghostCost = (s: StudioState) => 10 + 5 * (s.ghostsMade - 1);
export const wellCost = (s: StudioState) => [20, 35, 55].at(s.wellsBuilt) ?? 55 + 30 * (s.wellsBuilt - 2);

/**
 * One thing made: by whom (character, well or bowl id), what ('clay' or a paint colour), how much.
 * `back` marks paint the bowl gives back after a mix that made nothing new.
 */
export type Yield = { from: string; what: string; amount: number; back?: boolean };

/** A mix the bowl just finished: the two paints, and what they made (null: nothing new, paints given back). */
export type Mixed = { a: string; b: string; made: string | null };

export const bowlOf = (s: StudioState) => s.island.items.find((d) => d.kind === 'bowl') ?? null;

/** The colour a character's top glaze is (what it drops as paint), or null when it's bare clay. */
export const topColour = (r: CharacterRecipe) => r.layers.at(-1)?.colour ?? null;

/** Let `seconds` pass: everyone and every well makes what it would have made in that time. */
export function advance(s: StudioState, seconds: number): { state: StudioState; yields: Yield[]; mixed: Mixed | null } {
  const rand = mulberry32(s.seed);
  const progress = { ...s.progress };
  const wellTints = { ...s.wellTints };
  const yields: Yield[] = [];
  const dt = Math.max(0, seconds);

  for (const c of s.characters) {
    const { every, double } = RATES[c.personality];
    const p = (progress[c.id] ?? rand() * every) + dt; // newcomers start part-way, so drops don't all land at once
    const n = Math.floor(p / every);
    progress[c.id] = p - n * every;
    const colour = topColour(c);
    for (let i = 0; i < n; i++) {
      if (colour && rand() < PAINT_SHARE) yields.push({ from: c.id, what: colour, amount: 1 });
      else yields.push({ from: c.id, what: 'clay', amount: rand() < double ? 2 : 1 });
    }
  }
  const primaries = Object.values(PRIMARIES);
  for (const w of s.island.items.filter((d) => d.kind === 'well')) {
    const p = (progress[w.id] ?? 0) + dt;
    const n = Math.floor(p / WELL_EVERY);
    progress[w.id] = p - n * WELL_EVERY;
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
      for (let i = 0; i < MIX_MAKES; i++) yields.push({ from, what: made, amount: 1 });
      if (!discovered.includes(made)) discovered = [...discovered, made];
    } else yields.push({ from, what: bowl.a, amount: 1, back: true }, { from, what: bowl.b, amount: 1, back: true });
    mixed = { a: bowl.a, b: bowl.b, made };
    bowl = null;
  }
  return { state: { ...s, progress, wellTints, bowl, discovered, seed: Math.floor(rand() * 2 ** 31) }, yields, mixed };
}

export function addTo(p: Purse, what: string, amount: number): Purse {
  if (what === 'clay') return { ...p, clay: p.clay + amount };
  return { ...p, paint: { ...p.paint, [what]: (p.paint[what] ?? 0) + amount } };
}

const isEmpty = (p: Purse) => p.clay === 0 && Object.values(p.paint).every((n) => n === 0);

/**
 * Coming back after time away (or a reload): what was made meanwhile goes on the "While you were away"
 * card, capped at 8 hours. A clock that went backwards makes nothing; a short break just carries on.
 */
export function comeBack(s: StudioState, now: number): { state: StudioState; seconds: number } {
  const seconds = Math.min(AWAY_CAP, Math.max(0, (now - s.lastSeen) / 1000));
  if (seconds < AWAY_MIN) return { state: { ...s, lastSeen: now }, seconds: 0 };
  const { state, yields } = advance(s, seconds);
  let away: Purse = s.away ? { clay: s.away.clay, paint: { ...s.away.paint } } : emptyPurse();
  for (const y of yields) away = addTo(away, y.what, y.amount);
  const total = (s.away?.seconds ?? 0) + seconds;
  return { state: { ...state, away: isEmpty(away) ? s.away : { ...away, seconds: total }, lastSeen: now }, seconds };
}

export function collectAway(s: StudioState): StudioState {
  if (!s.away) return s;
  let purse = s.purse;
  purse = addTo(purse, 'clay', s.away.clay);
  for (const [c, n] of Object.entries(s.away.paint)) purse = addTo(purse, c, n);
  return { ...s, purse, away: null };
}

/** Put fresh yields on the ground at (x, z) spots chosen by `spot`; anything past the limit is held, not lost. */
export function dropOnGround(
  s: StudioState,
  yields: Yield[],
  spot: (y: Yield, i: number) => { x: number; z: number },
): { state: StudioState; dropped: { drop: Drop; index: number }[] } {
  const ground = [...s.ground];
  let held = s.held;
  const dropped: { drop: Drop; index: number }[] = [];
  yields.forEach((y, i) => {
    if (ground.length < MAX_GROUND) {
      const d: Drop = { id: `d${s.seed.toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`, ...spot(y, i), what: y.what, amount: y.amount };
      ground.push(d);
      dropped.push({ drop: d, index: i });
    } else held = addTo(held, y.what, y.amount);
  });
  return { state: { ...s, ground, held }, dropped };
}

/** Tap a drop: it goes into your purse. If anything was held back, one held thing comes out to replace it. */
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
  if (bowlOf(s) || s.purse.clay < BOWL_COST) return null; // one bowl is enough
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
export function dip(s: StudioState, characterId: string, colour: string): StudioState | null {
  const c = s.characters.find((r) => r.id === characterId);
  if (!c || c.layers.length || (s.purse.paint[colour] ?? 0) < 1) return null;
  const dipped: CharacterRecipe = { ...c, layers: [defaultLayer(colour)] };
  return {
    ...s,
    purse: { ...s.purse, paint: { ...s.purse.paint, [colour]: s.purse.paint[colour] - 1 } },
    characters: s.characters.map((r) => (r.id === characterId ? dipped : r)),
  };
}

/** The one next thing to aim for, always shown. */
export function nextGoal(s: StudioState): string {
  const more = (n: number) => `${n} more clay`;
  const paints = Object.values(s.purse.paint).reduce((n, k) => n + k, 0);
  if (!s.wellsBuilt) {
    const cost = wellCost(s);
    return s.purse.clay >= cost ? 'Next: build your first glaze well!' : `Next: Glaze well, ${more(cost - s.purse.clay)}`;
  }
  const bare = s.characters.some((c) => !c.layers.length);
  const anyDipped = s.characters.some((c) => c.layers.length);
  if (bare && paints && !anyDipped) return 'Next: tap a ghost and dip it in paint';
  if (!anyDipped) return 'Next: collect a paint drop from the well';
  if (!bowlOf(s)) {
    return s.purse.clay >= BOWL_COST ? 'Next: build the mixing bowl!' : `Next: Mixing bowl, ${more(BOWL_COST - s.purse.clay)}`;
  }
  if (s.bowl) return 'The bowl is stirring…';
  if (!s.discovered.length) return paints >= 2 ? 'Next: tap the bowl and mix two paints' : 'Next: collect two paints to mix';
  const found = MIXABLE.filter((c) => s.discovered.includes(c)).length;
  if (found < MIXABLE.length && paints >= 2) return `Next: mix a new colour (${found} of ${MIXABLE.length} found)`;
  if (bare && paints) return 'Next: tap a ghost and dip it in paint';
  const cost = ghostCost(s);
  return s.purse.clay >= cost ? 'Next: make a new ghost!' : `Next: another ghost, ${more(cost - s.purse.clay)}`;
}
