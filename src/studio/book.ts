/*
 * The palette book: every glaze colour and lustre, as a collection to complete. A colour counts as found once
 * you've owned it. Every 6 found brings a special decoration into storage, and the full book a rainbow piece.
 * Pure functions, like economy.ts; tests/studio-book.test.ts checks them.
 */
import { GLAZES, METALS } from '../character/palette';
import type { DecorKind } from '../scene/layout';
import { recipeFor, WHITE } from './mixing';
import { PRIMARIES, type StudioState } from './state';
import { store } from './storage';

export type Page = { hex: string; name: string; lustre: boolean };
/** The book's pages: the 18 glaze colours, then the 4 lustres. */
export const PAGES: Page[] = [...GLAZES.map((g) => ({ ...g, lustre: false })), ...METALS.map((m) => ({ ...m, lustre: true }))];

/** Rewards along the way: a special decoration at each count of colours found. */
export const REWARDS: { at: number; kind: DecorKind; name: string }[] = [
  { at: 6, kind: 'vase', name: 'a glazed vase' },
  { at: 12, kind: 'mosaic', name: 'a tile mosaic' },
  { at: 18, kind: 'totem', name: 'a stack of glazed bowls' },
  { at: PAGES.length, kind: 'rainbow', name: 'a rainbow glaze-drip pot' },
];

const PRIMARY = Object.values(PRIMARIES) as string[];

/** Where a colour comes from, for its page: the wells, the stars, a recipe, or the kiln. */
export function source(p: Page): string {
  if (p.lustre) return 'From the kiln (coming later)';
  if (PRIMARY.includes(p.hex)) return 'From the glaze wells';
  if (p.hex === WHITE) return 'From shooting stars';
  const r = recipeFor(p.hex);
  if (r) return `${nameOf(r[0])} + ${nameOf(r[1])}`;
  return '';
}
const nameOf = (hex: string) => PAGES.find((p) => p.hex === hex)?.name.toLowerCase() ?? 'paint';

export const foundCount = (s: StudioState) => PAGES.filter((p) => s.book.found.includes(p.hex)).length;

/**
 * Note any colours you now own (or have made, or glazed with) as found, and hand out any rewards reached
 * (into storage). Returns the same state if nothing changed.
 */
export function noteFound(s: StudioState): { state: StudioState; rewards: typeof REWARDS } {
  const owned = new Set(s.book.found);
  const before = owned.size;
  for (const [c, n] of Object.entries(s.purse.paint)) if (n > 0) owned.add(c);
  for (const c of s.discovered) owned.add(c);
  for (const c of s.characters) for (const l of c.layers) owned.add(l.colour);
  let next = owned.size === before ? s : { ...s, book: { ...s.book, found: PAGES.map((p) => p.hex).filter((h) => owned.has(h)) } };
  const got: typeof REWARDS = [];
  const count = foundCount(next);
  while (next.book.rewards < REWARDS.length && count >= REWARDS[next.book.rewards].at) {
    const reward = REWARDS[next.book.rewards];
    next = { ...store(next, reward.kind), book: { ...next.book, rewards: next.book.rewards + 1 } };
    got.push(reward);
  }
  return { state: next, rewards: got };
}
