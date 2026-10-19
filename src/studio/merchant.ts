/*
 * The balloon merchant's rules, as pure functions like economy.ts. He sells things (never knowledge),
 * grows with the clay paid to him, and visits now and then: his comings and goings carry on while you're away too,
 * so catching him is a little special.
 * All prices and times are first guesses; tests/studio-merchant.test.ts checks them.
 */
import type { DecorKind } from '../scene/layout';
import { store } from './storage';
import { PRIMARIES, type Merchant, type Offer, type StudioState, type Trait } from './state';

/**
 * How far his balloon can carry him. Each step is reached by the total clay paid to him: he grows,
 * stays a little longer, finds new kinds of things, and packs one more kind into his basket.
 */
export const STEPS = [
  { name: 'Nearby', paid: 0, scale: 1.6, stay: 20 * 60, offers: 4, news: '' },
  { name: 'The coast', paid: 300, scale: 2, stay: 25 * 60, offers: 5, news: 'shells, sea glass' },
] as const;

export const NEXT_VISIT = { min: 3600, max: 2 * 3600 }; // seconds between visits: seeing him is a treat
export const LINGER = 5 * 60; // if you come back near the end of his visit, he stays at least this much longer

/** How likely a kind of thing is to be in his basket (a weight), and how many of it he brings. */
export const RARITY = {
  common: { weight: 3, min: 2, max: 3 },
  uncommon: { weight: 2, min: 1, max: 2 },
  rare: { weight: 1, min: 1, max: 1 },
} as const;
export type Rarity = keyof typeof RARITY;

export type Item = {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  clay: number;
  paint?: { colour: string; n: number }; // rarer things also ask for a paint
  step: number; // the step he must have reached to bring it
  rarity: Rarity;
  decor?: DecorKind;
  trait?: Trait;
};

export const ITEMS: Item[] = [
  { id: 'tree', icon: '🌲', name: 'Tree', blurb: 'A glazed tree for some shade.', clay: 15, step: 0, rarity: 'common', decor: 'tree' },
  { id: 'rock', icon: '🪨', name: 'Rock', blurb: 'A smooth pale stone to sit by.', clay: 8, step: 0, rarity: 'common', decor: 'rock' },
  { id: 'mushroom', icon: '🍄', name: 'Mushroom', blurb: 'A little one, for the grass.', clay: 12, step: 0, rarity: 'common', decor: 'mushroom' },
  { id: 'pond', icon: '💧', name: 'Pond', blurb: 'A small pond with a ring of pebbles.', clay: 25, step: 0, rarity: 'uncommon', decor: 'pond' },
  {
    id: 'broom', icon: '🧹', name: 'Broom', blurb: 'Give it to someone: they become Tidy and pick up drops by themselves.',
    clay: 60, paint: { colour: PRIMARIES.yellow, n: 2 }, step: 0, rarity: 'rare', trait: 'tidy',
  },
  { id: 'shell', icon: '🐚', name: 'Shell', blurb: 'A scallop shell from the coast.', clay: 20, step: 1, rarity: 'uncommon', decor: 'shell' },
  {
    id: 'seaglass', icon: '💎', name: 'Sea glass', blurb: 'A pebble of frosted sea glass, worn smooth.',
    clay: 15, paint: { colour: PRIMARIES.cobalt, n: 1 }, step: 1, rarity: 'rare', decor: 'seaglass',
  },
];

/** The furthest step he has reached. */
export const stepOf = (s: StudioState) => STEPS.reduce((n, st, i) => (s.merchant.paid >= st.paid ? i : n), 0);
/** The next step, if there is one. */
export const nextStep = (s: StudioState) => STEPS[stepOf(s) + 1] ?? null;
/** Everything he can find at his current step (what a basket is packed from). */
export const findable = (step: number) => ITEMS.filter((i) => i.step <= step);

/**
 * Pack his basket for a visit: `count` different things, rarer ones less likely, each in a small amount
 * that depends on its rarity.
 */
export function packBasket(step: number, rand: () => number): Offer[] {
  const pool = [...findable(step)];
  const offers: Offer[] = [];
  while (offers.length < STEPS[step].offers && pool.length) {
    let roll = rand() * pool.reduce((n, i) => n + RARITY[i.rarity].weight, 0);
    const i = pool.findIndex((item) => (roll -= RARITY[item.rarity].weight) < 0);
    const item = pool.splice(i < 0 ? pool.length - 1 : i, 1)[0];
    const { min, max } = RARITY[item.rarity];
    offers.push({ id: item.id, left: min + Math.floor(rand() * (max - min + 1)) });
  }
  return offers;
}

/** True once everything he brought this visit is sold: then he packs up and goes. */
export const soldOut = (m: Merchant) => !!m.here && !!m.offers?.length && m.offers.every((o) => o.left < 1);

/** What he brought this visit, in shop order, with how many are left. */
export const stock = (s: StudioState): (Item & { left: number })[] =>
  ITEMS.flatMap((item) => {
    const offer = s.merchant.offers?.find((o) => o.id === item.id);
    return offer ? [{ ...item, left: offer.left }] : [];
  });

export const canAfford = (s: StudioState, item: Item) =>
  s.purse.clay >= item.clay && (!item.paint || (s.purse.paint[item.paint.colour] ?? 0) >= item.paint.n);

const pay = (s: StudioState, clay: number): StudioState => ({
  ...s,
  purse: { ...s.purse, clay: s.purse.clay - clay },
  merchant: { ...s.merchant, paid: s.merchant.paid + clay },
});

export type Bought = { state: StudioState } | { why: 'away' | 'stock' | 'soldout' | 'cost' | 'who' };

/** Buy something from him. A decoration goes into storage (place it with Arrange); a trait item goes to `characterId`. */
export function buyItem(s: StudioState, id: string, characterId?: string): Bought {
  const item = ITEMS.find((i) => i.id === id);
  if (!s.merchant.here) return { why: 'away' };
  const offer = s.merchant.offers?.find((o) => o.id === id);
  if (!item || !offer) return { why: 'stock' };
  if (offer.left < 1) return { why: 'soldout' };
  if (!canAfford(s, item)) return { why: 'cost' };
  let next = pay(s, item.clay);
  const offers = s.merchant.offers!.map((o) => (o.id === id ? { ...o, left: o.left - 1 } : o));
  next = { ...next, merchant: { ...next.merchant, offers } };
  if (item.paint) {
    const { colour, n } = item.paint;
    next = { ...next, purse: { ...next.purse, paint: { ...next.purse.paint, [colour]: next.purse.paint[colour] - n } } };
  }
  if (item.decor) return { state: store(next, item.decor) };
  if (item.trait) {
    const given = giveTrait(next, characterId ?? '', item.trait);
    return given ? { state: given } : { why: 'who' };
  }
  return { state: next };
}

/** Give him clay just to help him travel further. */
export function giveClay(s: StudioState, clay: number): StudioState | null {
  if (!s.merchant.here || clay <= 0 || s.purse.clay < clay) return null;
  return pay(s, clay);
}

export const hasTrait = (s: StudioState, characterId: string, trait: Trait) => (s.traits[characterId] ?? []).includes(trait);

/** A character gains a trait (once; at most 3 traits each). */
export function giveTrait(s: StudioState, characterId: string, trait: Trait): StudioState | null {
  const have = s.traits[characterId] ?? [];
  if (!s.characters.some((c) => c.id === characterId) || have.includes(trait) || have.length >= 3) return null;
  return { ...s, traits: { ...s.traits, [characterId]: [...have, trait] } };
}

/**
 * His visits as time passes. He comes once the mixing bowl exists, then stays a few minutes and goes away for a while.
 * Both run all the time, away too, so a long time away may hold whole visits you missed.
 * `visit` says whether he's newly here or newly gone compared with before.
 */
export function stepVisit(
  m: Merchant, hasBowl: boolean, step: number, dt: number, rand: () => number,
): { merchant: Merchant; visit: 'arrived' | 'left' | null } {
  const stayFor = STEPS[step].stay;
  let now = m.here && !m.offers ? { ...m, offers: packBasket(step, rand) } : m; // a save from before baskets
  if (!now.here && now.wait > NEXT_VISIT.max) now = { ...now, wait: NEXT_VISIT.max }; // a wait from older, rarer rules
  let left = dt;
  while (hasBowl) {
    if (!now.here) {
      if (now.wait > left) {
        now = { ...now, wait: now.wait - left };
        break;
      }
      left -= now.wait;
      now = { ...now, here: true, wait: 0, stay: stayFor, visits: now.visits + 1, offers: packBasket(step, rand) };
    } else {
      if (soldOut(now)) now = { ...now, stay: 0 }; // nothing left to sell: off he goes, and his time away starts
      if (now.stay > left) {
        now = { ...now, stay: now.stay - left };
        break;
      }
      left -= now.stay;
      now = { ...now, here: false, stay: 0, wait: NEXT_VISIT.min + rand() * (NEXT_VISIT.max - NEXT_VISIT.min), offers: null };
    }
  }
  const visit = now.here === m.here ? null : now.here ? 'arrived' : 'left';
  return { merchant: now, visit };
}

/** Drops close enough for a Tidy character to pick up: ids, each only once. */
export function tidyPickups(ground: { id: string; x: number; z: number }[], tidy: { x: number; z: number }[], reach = 1.2): string[] {
  return ground.filter((d) => tidy.some((t) => Math.hypot(d.x - t.x, d.z - t.z) <= reach)).map((d) => d.id);
}
