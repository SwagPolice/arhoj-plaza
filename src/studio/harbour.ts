/*
 * The harbour's rules, as pure functions like economy.ts and merchant.ts. Characters sail off on expeditions
 * and come back with finds: more crew means more finds, and personalities and traits tilt what they find.
 * Trips run in real time (away too), never fail, and wait in the crate until you collect them.
 * All numbers are first guesses; tests/studio-harbour.test.ts checks them.
 */
import { GLAZES } from '../character/palette';
import { DECOR_KINDS, placeAtEdge, type DecorKind } from '../scene/layout';
import { store } from './storage';
import { giveTrait, hasTrait, stepOf } from './merchant';
import { PRIMARIES, type Find, type Harbour, type StudioState } from './state';

export const HARBOUR_COST = 300;
export const BIG_BOAT_COST = 400;
export const SEAFARER_TRIPS = 3; // trips that make a character a Seafarer

const hex = (name: string) => GLAZES.find((g) => g.name === name)!.hex;
const PRIMARY = Object.values(PRIMARIES) as string[];
const MIXED = [hex('Orange'), hex('Green'), hex('Plum')];

/** One kind of find: 'clay', a paint colour (one picked from a list), or a decoration kind, and how many. */
type Loot = { what: string[]; min: number; max: number };
const loot = (what: string | string[], min = 1, max = min): Loot => ({ what: Array.isArray(what) ? what : [what], min, max });

export type Destination = {
  id: string;
  name: string; // "The shallows"
  seconds: number;
  finds: number; // per crew member
  step: number; // how far the merchant must have travelled to tell you the way
  loot: { common: Loot[]; uncommon: Loot[]; rare: Loot[] };
};

export const DESTINATIONS: Destination[] = [
  {
    id: 'shallows', name: 'The shallows', seconds: 30 * 60, finds: 3, step: 0,
    loot: { common: [loot('clay', 2, 5), loot(PRIMARY)], uncommon: [loot('shell'), loot(MIXED)], rare: [loot('driftwood')] },
  },
  {
    id: 'reef', name: 'The reef', seconds: 2 * 3600, finds: 4, step: 1,
    loot: { common: [loot('clay', 3, 7), loot([...PRIMARY, ...MIXED], 1, 2)], uncommon: [loot('shell'), loot('seaglass')], rare: [loot('coral')] },
  },
];

export const RARE = 0.05; // chance a find is rare…
export const UNCOMMON = 0.25; // …or uncommon (the rest are common)
export const SHY_LUCK = 0.03; // each shy crew member moves this much from common to rare

export const harbourOf = (s: StudioState) => s.island.items.find((d) => d.kind === 'harbour') ?? null;
/** The harbour can be built once you've met the merchant (he's the one who knows the way). */
export const harbourUnlocked = (s: StudioState) => s.merchant.visits > 0;
export const crewLimit = (s: StudioState) => (s.harbour.level >= 1 ? 5 : 3);
export const destination = (id: string) => DESTINATIONS.find((d) => d.id === id) ?? null;
/** A destination is open once the merchant has travelled that far and told you the way. */
export const isOpen = (s: StudioState, d: Destination) => s.merchant.visits > 0 && stepOf(s) >= d.step;
/** Characters away on the boat right now. */
export const atSea = (s: StudioState) => new Set(s.harbour.trip?.crew ?? []);

/** Finds each crew member makes: the destination's base, +1 if curious, +1 for a Seafarer. */
export function findsFor(s: StudioState, d: Destination, id: string) {
  const c = s.characters.find((r) => r.id === id);
  return d.finds + (c?.personality === 'curious' ? 1 : 0) + (hasTrait(s, id, 'seafarer') ? 1 : 0);
}

export function buyHarbour(s: StudioState): StudioState | null {
  if (harbourOf(s) || !harbourUnlocked(s) || s.purse.clay < HARBOUR_COST) return null;
  const spot = placeAtEdge(s.island, 'harbour');
  if (!spot) return null;
  return { ...s, purse: { ...s.purse, clay: s.purse.clay - HARBOUR_COST }, island: { ...s.island, items: [...s.island.items, spot] } };
}

export function buyBigBoat(s: StudioState): StudioState | null {
  if (!harbourOf(s) || s.harbour.level >= 1 || s.purse.clay < BIG_BOAT_COST) return null;
  return { ...s, purse: { ...s.purse, clay: s.purse.clay - BIG_BOAT_COST }, harbour: { ...s.harbour, level: 1 } };
}

export type Sailing = { state: StudioState } | { why: 'harbour' | 'busy' | 'haul' | 'closed' | 'crew' };

/** Send a crew (1 to 3, or 5 with the bigger boat) to an open destination. */
export function setSail(s: StudioState, to: string, crew: string[]): Sailing {
  const d = destination(to);
  if (!harbourOf(s)) return { why: 'harbour' };
  if (s.harbour.trip) return { why: 'busy' };
  if (s.harbour.haul) return { why: 'haul' }; // collect the last one first
  if (!d || !isOpen(s, d)) return { why: 'closed' };
  const ids = [...new Set(crew)];
  if (!ids.length || ids.length > crewLimit(s) || ids.some((id) => !s.characters.some((c) => c.id === id))) return { why: 'crew' };
  return { state: { ...s, harbour: { ...s.harbour, trip: { to, crew: ids, left: d.seconds } } } };
}

/** What a crew brings back: rolled per crew member, rarer when shy ones are aboard. Same seed, same haul. */
export function rollHaul(s: StudioState, d: Destination, crew: string[], rand: () => number): Find[] {
  const shy = crew.filter((id) => s.characters.find((c) => c.id === id)?.personality === 'shy').length;
  const rare = RARE + SHY_LUCK * shy;
  const finds: Find[] = [];
  for (const who of crew) {
    for (let i = 0; i < findsFor(s, d, who); i++) {
      const r = rand();
      const tier = r < rare ? d.loot.rare : r < rare + UNCOMMON ? d.loot.uncommon : d.loot.common;
      const l = tier[Math.floor(rand() * tier.length)];
      const what = l.what[Math.floor(rand() * l.what.length)];
      const amount = l.min + Math.floor(rand() * (l.max - l.min + 1));
      const same = finds.find((f) => f.who === who && f.what === what);
      if (same) same.amount += amount;
      else finds.push({ who, what, amount });
    }
  }
  return finds;
}

/**
 * The boat at sea as time passes (real time, away too). When it's back, the haul goes in the crate,
 * everyone aboard counts a trip, and a third trip makes a Seafarer.
 */
export function stepTrip(s: StudioState, dt: number, rand: () => number): { state: StudioState; home: boolean } {
  const trip = s.harbour.trip;
  if (!trip) return { state: s, home: false };
  if (trip.left > dt) return { state: { ...s, harbour: { ...s.harbour, trip: { ...trip, left: trip.left - dt } } }, home: false };
  const d = destination(trip.to);
  const crew = trip.crew.filter((id) => s.characters.some((c) => c.id === id));
  const finds = d ? rollHaul(s, d, crew, rand) : [];
  const trips = { ...s.harbour.trips };
  let next: StudioState = s;
  for (const id of crew) {
    trips[id] = (trips[id] ?? 0) + 1;
    if (trips[id] >= SEAFARER_TRIPS) next = giveTrait(next, id, 'seafarer') ?? next;
  }
  const harbour: Harbour = { ...s.harbour, trip: null, haul: finds.length ? { to: trip.to, finds } : null, trips };
  return { state: { ...next, harbour }, home: true };
}

const isPaint = (what: string) => what.startsWith('#');
const isDecor = (what: string): what is DecorKind => (DECOR_KINDS as readonly string[]).includes(what);

/** Empty the crate: clay and paint into your purse, decorations into storage (place them with Arrange). */
export function collectHaul(s: StudioState): { state: StudioState; stored: number } {
  const haul = s.harbour.haul;
  if (!haul) return { state: s, stored: 0 };
  let next: StudioState = { ...s, harbour: { ...s.harbour, haul: null } };
  let stored = 0;
  for (const f of haul.finds) {
    const purse = next.purse;
    if (f.what === 'clay') next = { ...next, purse: { ...purse, clay: purse.clay + f.amount } };
    else if (isPaint(f.what)) next = { ...next, purse: { ...purse, paint: { ...purse.paint, [f.what]: (purse.paint[f.what] ?? 0) + f.amount } } };
    else if (isDecor(f.what)) for (let i = 0; i < f.amount; i++, stored++) next = store(next, f.what);
  }
  return { state: next, stored };
}
