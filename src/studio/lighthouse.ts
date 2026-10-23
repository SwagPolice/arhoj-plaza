/*
 * The lighthouse's rules, as pure functions like merchant.ts. Once the merchant can reach the coast he can see
 * its light, out on its own little island just offshore: from it you can order from his last basket (sold out or not),
 * one thing or more once upgraded, for a little extra, and he brings them on his next visit. Nothing in his basket is lost for good.
 * All numbers are first guesses; tests/studio-lighthouse.test.ts checks them.
 */
import { MAX_DECOR, newDecorId, toSea } from '../scene/layout';
import { giveTrait, hasTrait, ITEMS, stepOf, type Item } from './merchant';
import { store } from './storage';
import type { Order, StudioState } from './state';
import { levelOf, ORDERS } from './upgrades';

export const LIGHTHOUSE_COST = 400;
/** Where its island goes: behind the big one, a little to the right, where there's sky for it to stand tall against. */
export const LIGHTHOUSE_ANGLE = (150 / 180) * Math.PI; // from +z (towards you) round towards +x (the right)
export const ORDER_EXTRA = 0.25; // an order costs his price plus a quarter more clay (paint stays the same)

export const lighthouseOf = (s: StudioState) => s.island.items.find((d) => d.kind === 'lighthouse') ?? null;
/** It can be built once the merchant reaches the coast: from there he's big enough to see its light. */
export const lighthouseUnlocked = (s: StudioState) => stepOf(s) >= 1;

export function buyLighthouse(s: StudioState): StudioState | null {
  if (lighthouseOf(s) || !lighthouseUnlocked(s) || s.purse.clay < LIGHTHOUSE_COST) return null;
  if (s.island.items.length >= MAX_DECOR) return null;
  const a = LIGHTHOUSE_ANGLE;
  const spot = toSea(s.island, { id: newDecorId('lighthouse'), kind: 'lighthouse', x: Math.sin(a), z: Math.cos(a), size: 1, rot: 0 });
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

export type Ordered = { state: StudioState } | { why: 'lighthouse' | 'here' | 'busy' | 'twice' | 'stock' | 'cost' | 'who' };

/** How many things you can order between his visits: 1, or more from an upgraded lighthouse. */
export function ordersAllowed(s: StudioState) {
  const l = lighthouseOf(s);
  return l ? ORDERS[levelOf(s, l)] : 0;
}

/**
 * Signal him for something from his last basket. As many orders between visits as the lighthouse allows, one of
 * each thing; you pay now, and it counts towards his trip.
 */
export function orderItem(s: StudioState, id: string): Ordered {
  if (!lighthouseOf(s)) return { why: 'lighthouse' };
  if (s.merchant.here) return { why: 'here' };
  if (s.merchant.orders.length >= ordersAllowed(s)) return { why: 'busy' };
  if (s.merchant.orders.some((o) => o.id === id)) return { why: 'twice' };
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
      merchant: { ...s.merchant, paid: s.merchant.paid + price.clay, orders: [...s.merchant.orders, price] },
    },
  };
}

/** Change your mind about one order before he comes: everything you paid for it comes back. */
export function cancelOrder(s: StudioState, id: string): StudioState | null {
  const o = s.merchant.orders.find((x) => x.id === id);
  if (!o) return null;
  const paint = o.paint ? { ...s.purse.paint, [o.paint.colour]: (s.purse.paint[o.paint.colour] ?? 0) + o.paint.n } : s.purse.paint;
  return {
    ...s,
    purse: { clay: s.purse.clay + o.clay, paint },
    merchant: { ...s.merchant, paid: Math.max(0, s.merchant.paid - o.clay), orders: s.merchant.orders.filter((x) => x !== o) },
  };
}

/**
 * He's brought what you ordered: decorations go straight into storage. Trait items wait (`deliveries`) until
 * you pick who gets each (`handOver`). `delivered` is what just went into storage.
 */
export function unpack(s: StudioState): { state: StudioState; delivered: Item[] } {
  if (!s.merchant.deliveries.length) return { state: s, delivered: [] };
  let next = s;
  const delivered: Item[] = [];
  const keep: string[] = [];
  for (const id of s.merchant.deliveries) {
    const item = ITEMS.find((i) => i.id === id);
    if (item?.decor) {
      next = store(next, item.decor);
      delivered.push(item);
    } else if (item?.trait) keep.push(id); // waits for who gets it; anything unknown is dropped
  }
  if (keep.length === s.merchant.deliveries.length) return { state: s, delivered };
  return { state: { ...next, merchant: { ...next.merchant, deliveries: keep } }, delivered };
}

/** The next trait item he brought, if one is waiting for someone. */
export const waiting = (s: StudioState): Item | null => {
  const item = ITEMS.find((i) => i.id === s.merchant.deliveries[0]);
  return item?.trait ? item : null;
};

/** Give the trait item he brought to a character. */
export function handOver(s: StudioState, characterId: string): StudioState | null {
  const item = waiting(s);
  if (!item) return null;
  const given = giveTrait(s, characterId, item.trait!);
  return given && { ...given, merchant: { ...given.merchant, deliveries: given.merchant.deliveries.slice(1) } };
}
