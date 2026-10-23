/*
 * Upgrades: wells, the mixing bowl, the harbour and the lighthouse can each be upgraded twice, for clay, each level
 * dearer than the last, and each one shows on the building. Pure functions, like economy.ts;
 * tests/studio-upgrades.test.ts checks them. (The harbour keeps its level in `harbour.level`, from when its bigger
 * boat was its only upgrade; the others keep theirs in `levels`, by id, so a well put away keeps its level.)
 */
import type { Decor, DecorKind } from '../scene/layout';
import type { StudioState } from './state';

export type Upgradable = 'well' | 'bowl' | 'harbour' | 'lighthouse';
export const MAX_LEVEL = 2;

/** What each level is called, what it does, and what it costs. */
export const UPGRADES: Record<Upgradable, { name: string; does: string; cost: number }[]> = {
  well: [
    { name: 'Deeper well', does: 'A paint every 115 seconds (from 150).', cost: 100 },
    { name: 'Spring-fed well', does: 'A paint every 85 seconds.', cost: 300 },
  ],
  bowl: [
    { name: 'Bigger bowl', does: 'Each mix makes 3 of the new colour (from 2).', cost: 150 },
    { name: 'Wide bowl', does: 'Each mix makes 4.', cost: 500 },
  ],
  harbour: [
    { name: 'Bigger boat', does: 'Takes 5 crew (from 3).', cost: 400 },
    { name: 'Swift sails', does: 'Expeditions take two thirds of the time.', cost: 900 },
  ],
  lighthouse: [
    { name: 'Brighter lamp', does: 'Order 2 things between visits (from 1).', cost: 500 },
    { name: 'Great lamp', does: 'Order 3 things between visits.', cost: 1200 },
  ],
};

/** Each level's effect: a well's seconds per paint, a mix's batch, a trip's length, the orders allowed. */
export const WELL_EVERY = [150, 115, 85];
export const MIX_MAKES = [2, 3, 4];
export const TRIP_TIME = [1, 1, 2 / 3];
export const ORDERS = [1, 2, 3];

export const upgradable = (kind: DecorKind): kind is Upgradable => kind in UPGRADES;

/** How far something has been upgraded (0 to 2). */
export function levelOf(s: StudioState, d: Pick<Decor, 'id' | 'kind'>): number {
  if (d.kind === 'harbour') return Math.min(MAX_LEVEL, s.harbour.level);
  return Math.min(MAX_LEVEL, s.levels[d.id] ?? 0);
}

/** The next upgrade for something on the island, or null if it can't be upgraded (any further). */
export function nextUpgrade(s: StudioState, d: Pick<Decor, 'id' | 'kind'>) {
  if (!upgradable(d.kind)) return null;
  const level = levelOf(s, d);
  return level < MAX_LEVEL ? { level: level + 1, ...UPGRADES[d.kind][level] } : null;
}

/** Upgrade something on the island by a level, paying its clay. Null if it can't be, or you can't afford it. */
export function upgrade(s: StudioState, id: string): StudioState | null {
  const d = s.island.items.find((x) => x.id === id);
  const next = d && nextUpgrade(s, d);
  if (!d || !next || s.purse.clay < next.cost) return null;
  const paid = { ...s, purse: { ...s.purse, clay: s.purse.clay - next.cost } };
  if (d.kind === 'harbour') return { ...paid, harbour: { ...paid.harbour, level: next.level } };
  return { ...paid, levels: { ...paid.levels, [id]: next.level } };
}
