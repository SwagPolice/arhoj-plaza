/*
 * The lighthouse's rules, as pure functions like merchant.ts. Once the merchant can reach the coast he can see
 * its light: from it you can order one thing from his last basket (sold out or not), for a little extra, and he
 * brings it on his next visit. Nothing in his basket is lost for good.
 * All numbers are first guesses; tests/studio-lighthouse.test.ts checks them.
 */
import { EDGE_SPOT, placeAtEdge } from '../scene/layout';
import { giveTrait, hasTrait, ITEMS, stepOf, type Item } from './merchant';
import { store } from './storage';
import type { Order, StudioState } from './state';

export const LIGHTHOUSE_COST = 400;
export const ORDER_EXTRA = 0.25; // an order costs his price plus a quarter more clay (paint stays the same)

export const lighthouseOf = (s: StudioState) => s.island.items.find((d) => d.kind === 'lighthouse') ?? null;
/** It can be built once the merchant reaches the coast: from there he's big enough to see its light. */
export const lighthouseUnlocked = (s: StudioState) => stepOf(s) >= 1;

export function buyLighthouse(s: StudioState): StudioState | null {
  if (lighthouseOf(s) || !lighthouseUnlocked(s) || s.purse.clay < LIGHTHOUSE_COST) return null;
  const spot = placeAtEdge(s.island, 'lighthouse', EDGE_SPOT.right);
  if (!spot) return null;
  return { ...s, purse: { ...s.purse, clay: s.purse.clay - LIGHTHOUSE_COST }, island: { ...s.island, items: [...s.island.items, spot] } };
}

/** What ordering it costs: his price plus 25% clay, rounded up; any paint stays the same. */
export const orderPrice = (item: Item): Order => ({
  id: item.id,
  clay: Math.ceil(item.clay * (1 + ORDER_EXTRA)),
  ...(item.paint ? { paint: { ...item.paint } } : {}),
});

/** What was in his basket last visit, in shop order: what you can order from. */
export const lastBasket = (s: StudioState): Item[] => ITEMS.filter((i) => s.merchant.last.includes(i.id));

/** Someone who could still be given this trait item (not everyone has it, or 3 traits already). */
export const canReceive = (s: StudioState, item: Item) =>
  !item.trait || s.characters.some((c) => !hasTrait(s, c.id, item.trait!) && (s.traits[c.id] ?? []).length < 3);

export type Ordered = { state: StudioState } | { why: 'lighthouse' | 'here' | 'busy' | 'stock' | 'cost' | 'who' };

/** Signal him for one thing from his last basket. One order between visits; you pay now, and it counts towards his trip. */
export function orderItem(s: StudioState, id: string): Ordered {
  if (!lighthouseOf(s)) return { why: 'lighthouse' };
  if (s.merchant.here) return { why: 'here' };
  if (s.merchant.order || s.merchant.delivery) return { why: 'busy' };
  const item = lastBasket(s).find((i) => i.id === id);
  if (!item) return { why: 'stock' };
  if (!canReceive(s, item)) return { why: 'who' };
  const price = orderPrice(item);
  if (s.purse.clay < price.clay || (price.paint && (s.purse.paint[price.paint.colour] ?? 0) < price.paint.n)) return { why: 'cost' };
  const paint = price.paint ? { ...s.purse.paint, [price.paint.colour]: s.purse.paint[price.paint.colour] - price.paint.n } : s.purse.paint;
  return {
    state: {
      ...s,
      purse: { clay: s.purse.clay - price.clay, paint },
      merchant: { ...s.merchant, paid: s.merchant.paid + price.clay, order: price },
    },
  };
}

/** Change your mind before he comes: everything you paid comes back. */
export function cancelOrder(s: StudioState): StudioState | null {
  const o = s.merchant.order;
  if (!o) return null;
  const paint = o.paint ? { ...s.purse.paint, [o.paint.colour]: (s.purse.paint[o.paint.colour] ?? 0) + o.paint.n } : s.purse.paint;
  return {
    ...s,
    purse: { clay: s.purse.clay + o.clay, paint },
    merchant: { ...s.merchant, paid: Math.max(0, s.merchant.paid - o.clay), order: null },
  };
}

/**
 * He's brought what you ordered: a decoration goes straight into storage. A trait item waits (`delivery`) until
 * you pick who gets it (`handOver`). `delivered` is the item that just went into storage, if any.
 */
export function unpack(s: StudioState): { state: StudioState; delivered: Item | null } {
  const item = ITEMS.find((i) => i.id === s.merchant.delivery);
  if (!item) return { state: s.merchant.delivery ? { ...s, merchant: { ...s.merchant, delivery: null } } : s, delivered: null };
  if (!item.decor) return { state: s, delivered: null };
  return { state: { ...store(s, item.decor), merchant: { ...s.merchant, delivery: null } }, delivered: item };
}

/** The trait item he brought, if one is waiting for someone. */
export const waiting = (s: StudioState): Item | null => {
  const item = ITEMS.find((i) => i.id === s.merchant.delivery);
  return item?.trait ? item : null;
};

/** Give the trait item he brought to a character. */
export function handOver(s: StudioState, characterId: string): StudioState | null {
  const item = waiting(s);
  if (!item) return null;
  const given = giveTrait(s, characterId, item.trait!);
  return given && { ...given, merchant: { ...given.merchant, delivery: null } };
}
