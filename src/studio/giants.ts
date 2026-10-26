/*
 * Giants of the sea: now and then, while you're playing, a giant rises from the sea beside the island, stays a
 * little while, and sinks back. Catch it with a tap for a small gift. Each kind you've seen goes into the book of
 * giants; seeing all three brings a little serpent figurine. Never more than one a day.
 * Pure functions, like economy.ts; tests/studio-giants.test.ts checks them.
 */
import { addTo } from './economy';
import { store } from './storage';
import { PRIMARIES, GIANT_KINDS, type GiantKind, type Purse, type StudioState } from './state';
import { WHITE } from './stars';

export { GIANT_KINDS, type GiantKind };
export const GIANT_GAP = 24 * 3600 * 1000; // ms between two giants, at least (real time, away too)
export const GIANT_CHANCE = 0.03; // each minute of play, once the gap has passed
export const GIANT_STAY = 30; // seconds one stays before sinking back
export const UNSEEN_WEIGHT = 3; // kinds you haven't seen yet are this much more likely

/** Their names and a line about each, for toasts and the book. */
export const GIANTS: Record<GiantKind, { name: string; icon: string; blurb: string }> = {
  ghost: { name: 'Giant ghost', icon: '👻', blurb: 'A huge white ghost that rises up to its eyes to look at your island.' },
  serpent: { name: 'Sea serpent', icon: '🐍', blurb: 'A glazed serpent that glides past in humps, then dives.' },
  mushroom: { name: 'Glass mushroom', icon: '🍄', blurb: 'A giant glass mushroom that bobs up like a jellyfish.' },
};

/**
 * A minute of play went by: does a giant rise? Null until a day has passed since the last; then a small chance,
 * with kinds you haven't met more likely, so the book fills up.
 */
export function rollGiant(s: StudioState, now: number, rand: () => number): GiantKind | null {
  if (now < s.giants.next || rand() >= GIANT_CHANCE) return null;
  const weights = GIANT_KINDS.map((k) => (s.giants.seen.includes(k) ? 1 : UNSEEN_WEIGHT));
  let roll = rand() * weights.reduce((a, b) => a + b, 0);
  return GIANT_KINDS.find((_, i) => (roll -= weights[i]) < 0) ?? GIANT_KINDS[GIANT_KINDS.length - 1];
}

/** A giant has risen: no other for a day, and it's in the book (tapped or not). */
export function sawGiant(s: StudioState, kind: GiantKind, now: number): StudioState {
  const seen = s.giants.seen.includes(kind) ? s.giants.seen : [...s.giants.seen, kind];
  return { ...s, giants: { ...s.giants, next: now + GIANT_GAP, seen } };
}

/**
 * What tapping a giant gives: the ghost a handful of clay, the serpent a few drops of a colour you've found
 * (or a primary), the mushroom a little white.
 */
export function giftFrom(s: StudioState, kind: GiantKind, rand: () => number): Purse {
  if (kind === 'ghost') return { clay: 20 + Math.floor(rand() * 16), paint: {} };
  if (kind === 'mushroom') return { clay: 0, paint: { [WHITE]: 2 } };
  const colours = [...new Set([...Object.values(PRIMARIES), ...s.discovered])];
  return { clay: 0, paint: { [colours[Math.floor(rand() * colours.length)]]: 2 + Math.floor(rand() * 2) } };
}

/** Put a gift into the purse. */
export function takeGift(s: StudioState, gift: Purse): StudioState {
  let purse = addTo(s.purse, 'clay', gift.clay);
  for (const [colour, n] of Object.entries(gift.paint)) purse = addTo(purse, colour, n);
  return { ...s, purse };
}

/** Seen all three? The serpent figurine goes into storage, once. `given` says whether it just did. */
export function giantReward(s: StudioState): { state: StudioState; given: boolean } {
  if (s.giants.rewarded || GIANT_KINDS.some((k) => !s.giants.seen.includes(k))) return { state: s, given: false };
  return { state: { ...store(s, 'figurine'), giants: { ...s.giants, rewarded: true } }, given: true };
}
