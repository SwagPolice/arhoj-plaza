/*
 * The balloon merchant's rules, as pure functions like economy.ts. He sells things (never knowledge),
 * grows with the clay paid to him, visits now and then, and always waits for you if he came while you were away.
 * All prices and times are first guesses; tests/studio-merchant.test.ts checks them.
 */
import { placeNew, type DecorKind } from '../scene/layout';
import { PRIMARIES, type Merchant, type StudioState, type Trait } from './state';

/** How far his balloon can carry him. Each step is reached by the total clay paid to him, and widens his stock. */
export const STEPS = [
  { name: 'Nearby', paid: 0, scale: 1.6, stay: 5 * 60, news: '' },
  { name: 'The coast', paid: 300, scale: 2, stay: 7 * 60, news: 'shells, sea glass' },
] as const;

export const NEXT_VISIT = { min: 8 * 60, max: 20 * 60 }; // seconds between visits

export type Item = {
  id: string;
  icon: string;
  name: string;
  blurb: string;
  clay: number;
  paint?: { colour: string; n: number }; // rarer things also ask for a paint
  step: number; // the step he must have reached to bring it
  decor?: DecorKind;
  trait?: Trait;
};

export const ITEMS: Item[] = [
  { id: 'tree', icon: '🌲', name: 'Tree', blurb: 'A glazed tree for some shade.', clay: 15, step: 0, decor: 'tree' },
  { id: 'rock', icon: '🪨', name: 'Rock', blurb: 'A smooth pale stone to sit by.', clay: 8, step: 0, decor: 'rock' },
  { id: 'mushroom', icon: '🍄', name: 'Mushroom', blurb: 'A little one, for the grass.', clay: 12, step: 0, decor: 'mushroom' },
  { id: 'pond', icon: '💧', name: 'Pond', blurb: 'A small pond with a ring of pebbles.', clay: 25, step: 0, decor: 'pond' },
  {
    id: 'broom', icon: '🧹', name: 'Broom', blurb: 'Give it to someone: they become Tidy and pick up drops by themselves.',
    clay: 60, paint: { colour: PRIMARIES.yellow, n: 2 }, step: 0, trait: 'tidy',
  },
  { id: 'shell', icon: '🐚', name: 'Shell', blurb: 'A scallop shell from the coast.', clay: 20, step: 1, decor: 'shell' },
  {
    id: 'seaglass', icon: '💎', name: 'Sea glass', blurb: 'A pebble of frosted sea glass, worn smooth.',
    clay: 15, paint: { colour: PRIMARIES.cobalt, n: 1 }, step: 1, decor: 'seaglass',
  },
];

/** The furthest step he has reached. */
export const stepOf = (s: StudioState) => STEPS.reduce((n, st, i) => (s.merchant.paid >= st.paid ? i : n), 0);
/** The next step, if there is one. */
export const nextStep = (s: StudioState) => STEPS[stepOf(s) + 1] ?? null;
/** What he has brought this time. */
export const stock = (s: StudioState) => ITEMS.filter((i) => i.step <= stepOf(s));

export const canAfford = (s: StudioState, item: Item) =>
  s.purse.clay >= item.clay && (!item.paint || (s.purse.paint[item.paint.colour] ?? 0) >= item.paint.n);

const pay = (s: StudioState, clay: number): StudioState => ({
  ...s,
  purse: { ...s.purse, clay: s.purse.clay - clay },
  merchant: { ...s.merchant, paid: s.merchant.paid + clay },
});

export type Bought = { state: StudioState; placed?: string } | { why: 'away' | 'stock' | 'cost' | 'room' | 'who' };

/** Buy something from him. A decoration is placed at once; a trait item goes to `characterId`. */
export function buyItem(s: StudioState, id: string, characterId?: string): Bought {
  const item = ITEMS.find((i) => i.id === id);
  if (!s.merchant.here) return { why: 'away' };
  if (!item || !stock(s).includes(item)) return { why: 'stock' };
  if (!canAfford(s, item)) return { why: 'cost' };
  let next = pay(s, item.clay);
  if (item.paint) {
    const { colour, n } = item.paint;
    next = { ...next, purse: { ...next.purse, paint: { ...next.purse.paint, [colour]: next.purse.paint[colour] - n } } };
  }
  if (item.decor) {
    const placed = placeNew(s.island, item.decor);
    if (!placed) return { why: 'room' };
    return { state: { ...next, island: { ...next.island, items: [...next.island.items, placed] } }, placed: placed.id };
  }
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
 * His visits as time passes. He comes once the mixing bowl exists. Time until his next visit runs always (away too),
 * but his stay only runs while you're playing (`live`), so he waits for you if he came while you were away.
 */
export function stepVisit(
  m: Merchant, hasBowl: boolean, stayFor: number, dt: number, live: boolean, rand: () => number,
): { merchant: Merchant; visit: 'arrived' | 'left' | null } {
  if (!m.here) {
    if (!hasBowl) return { merchant: m, visit: null };
    if (m.wait > dt) return { merchant: { ...m, wait: m.wait - dt }, visit: null };
    return { merchant: { ...m, here: true, wait: 0, stay: stayFor, visits: m.visits + 1 }, visit: 'arrived' };
  }
  if (!live) return { merchant: m, visit: null };
  if (m.stay > dt) return { merchant: { ...m, stay: m.stay - dt }, visit: null };
  const wait = NEXT_VISIT.min + rand() * (NEXT_VISIT.max - NEXT_VISIT.min);
  return { merchant: { ...m, here: false, stay: 0, wait }, visit: 'left' };
}

/** Drops close enough for a Tidy character to pick up: ids, each only once. */
export function tidyPickups(ground: { id: string; x: number; z: number }[], tidy: { x: number; z: number }[], reach = 1.2): string[] {
  return ground.filter((d) => tidy.some((t) => Math.hypot(d.x - t.x, d.z - t.z) <= reach)).map((d) => d.id);
}
