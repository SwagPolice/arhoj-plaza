import { describe, expect, test } from 'vitest';
import { advance, comeBack } from '../src/studio/economy';
import {
  BIG_BOAT_COST, buyBigBoat, buyHarbour, collectHaul, crewLimit, destination, DESTINATIONS, HARBOUR_COST, harbourOf, rollHaul, setSail,
  SEAFARER_TRIPS,
} from '../src/studio/harbour';
import { hasTrait } from '../src/studio/merchant';
import { bareGhost, newStudio, type StudioState } from '../src/studio/state';
import { canMove } from '../src/scene/layout';
import { mulberry32 } from '../src/util/random';
import type { Personality } from '../src/character/recipe';

const shallows = destination('shallows')!;
const reef = destination('reef')!;

/** A studio that has met the merchant (and, with `coast`, sent him to the coast), with a harbour and a few characters. */
function withHarbour(personalities: Personality[] = ['curious', 'calm', 'shy'], coast = false): StudioState {
  const base = newStudio(0);
  const s: StudioState = {
    ...base,
    seed: 5,
    lastSeen: 0,
    characters: personalities.map((p, i) => bareGhost({ id: `c${i}`, name: `C${i}`, personality: p })),
    purse: { clay: HARBOUR_COST, paint: {} },
    merchant: { ...base.merchant, visits: 1, paid: coast ? 300 : 0 },
  };
  return buyHarbour(s)!;
}

describe('building the harbour', () => {
  test('only after meeting the merchant, for 300 clay, on the edge facing the sea, and it stays put', () => {
    const base = { ...newStudio(0), purse: { clay: 1000, paint: {} } };
    expect(buyHarbour(base)).toBeNull(); // not met the merchant yet
    expect(buyHarbour({ ...base, merchant: { ...base.merchant, visits: 1 }, purse: { clay: HARBOUR_COST - 1, paint: {} } })).toBeNull();
    const s = withHarbour();
    expect(s.purse.clay).toBe(0);
    const h = harbourOf(s)!;
    expect(Math.hypot(h.x, h.z)).toBeGreaterThan(s.island.radius - 1);
    expect(Math.atan2(h.x, h.z)).toBeCloseTo(((h.rot + Math.PI) % (Math.PI * 2)) - Math.PI, 1); // faces out
    expect(canMove('harbour')).toBe(false);
    expect(buyHarbour({ ...s, purse: { clay: 1000, paint: {} } })).toBeNull(); // only one
  });

  test('a bigger boat takes 5 instead of 3', () => {
    const s = withHarbour();
    expect(crewLimit(s)).toBe(3);
    expect(buyBigBoat(s)).toBeNull();
    const big = buyBigBoat({ ...s, purse: { clay: BIG_BOAT_COST, paint: {} } })!;
    expect(crewLimit(big)).toBe(5);
    expect(big.purse.clay).toBe(0);
  });
});

describe('setting sail', () => {
  test('needs a harbour, an open destination, and 1 to 3 characters who live here', () => {
    const s = withHarbour(['curious', 'calm', 'shy', 'bouncy']);
    expect(setSail({ ...s, island: { ...s.island, items: [] } }, 'shallows', ['c0'])).toEqual({ why: 'harbour' });
    expect(setSail(s, 'reef', ['c0'])).toEqual({ why: 'closed' }); // the merchant hasn't reached the coast
    expect(setSail(s, 'shallows', [])).toEqual({ why: 'crew' });
    expect(setSail(s, 'shallows', ['c0', 'c1', 'c2', 'c3'])).toEqual({ why: 'crew' });
    expect(setSail(s, 'shallows', ['nobody'])).toEqual({ why: 'crew' });
    const r = setSail(s, 'shallows', ['c0', 'c1']);
    if (!('state' in r)) throw new Error(r.why);
    expect(r.state.harbour.trip).toEqual({ to: 'shallows', crew: ['c0', 'c1'], left: shallows.seconds });
    expect(setSail(r.state, 'shallows', ['c2'])).toEqual({ why: 'busy' }); // one boat
  });

  test('the reef opens once the merchant reaches the coast', () => {
    expect('state' in setSail(withHarbour(undefined, true), 'reef', ['c0'])).toBe(true);
  });
});

describe('at sea', () => {
  const sailing = (crew = ['c0']) => {
    const r = setSail(withHarbour(), 'shallows', crew);
    if (!('state' in r)) throw new Error(r.why);
    return r.state;
  };

  test('the crew makes nothing while away; the others carry on', () => {
    const { yields } = advance(sailing(['c0']), 600);
    expect(yields.some((y) => y.from === 'c0')).toBe(false);
    expect(yields.some((y) => y.from === 'c1')).toBe(true);
  });

  test('the boat comes back after the trip, with a haul in the crate', () => {
    const s = sailing(['c0', 'c1']);
    expect(advance(s, shallows.seconds - 1).boatHome).toBe(false);
    const back = advance(s, shallows.seconds);
    expect(back.boatHome).toBe(true);
    expect(back.state.harbour.trip).toBeNull();
    expect(back.state.harbour.haul!.finds.length).toBeGreaterThan(0);
    expect(back.state.harbour.trips).toEqual({ c0: 1, c1: 1 });
  });

  test('the trip runs in real time while you are away (not slowed like the making)', () => {
    const s = sailing();
    const back = comeBack(s, (shallows.seconds + 60) * 1000).state;
    expect(back.harbour.trip).toBeNull();
    expect(back.harbour.haul).not.toBeNull();
  });

  test('three trips make a Seafarer', () => {
    let s = withHarbour();
    for (let i = 0; i < SEAFARER_TRIPS; i++) {
      expect(hasTrait(s, 'c0', 'seafarer')).toBe(false);
      const r = setSail(s, 'shallows', ['c0']);
      if (!('state' in r)) throw new Error(r.why);
      s = collectHaul(advance(r.state, shallows.seconds).state).state;
    }
    expect(hasTrait(s, 'c0', 'seafarer')).toBe(true);
  });
});

describe('the haul', () => {
  const count = (finds: { amount: number }[]) => finds.length;

  test('more crew, more finds; curious ones find more; the same seed gives the same haul', () => {
    const s = withHarbour(['calm', 'calm', 'curious']);
    const finds = (crew: string[]) => rollHaul(s, shallows, crew, mulberry32(9));
    expect(finds(['c0'])).toEqual(finds(['c0']));
    // Count rolls, not merged lines: a calm member makes 3, a curious one 4.
    const rolls = (crew: string[]) => {
      let n = 0;
      const rand = mulberry32(3);
      const counting = () => {
        n++;
        return rand();
      };
      rollHaul(s, shallows, crew, counting);
      return n / 4; // each find takes 4 rolls
    };
    expect(rolls(['c0'])).toBe(3);
    expect(rolls(['c2'])).toBe(4);
    expect(rolls(['c0', 'c1', 'c2'])).toBe(10);
    expect(count(finds(['c0', 'c1', 'c2']))).toBeGreaterThan(0);
  });

  test('a shy crew brings rare things more often', () => {
    const calm = withHarbour(['calm', 'calm', 'calm']);
    const shy = withHarbour(['shy', 'shy', 'shy']);
    const rares = (s: StudioState) => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++)
        n += rollHaul(s, shallows, ['c0', 'c1', 'c2'], mulberry32(seed)).filter((f) => f.what === 'driftwood').reduce((k, f) => k + f.amount, 0);
      return n;
    };
    expect(rares(shy)).toBeGreaterThan(rares(calm) * 1.5);
  });

  test('finds come from the destination: driftwood only from the shallows, coral only from the reef', () => {
    const s = withHarbour(['shy', 'shy', 'shy'], true);
    const all = (d: typeof shallows) => new Set(Array.from({ length: 200 }, (_, i) => rollHaul(s, d, ['c0', 'c1', 'c2'], mulberry32(i + 1))).flat().map((f) => f.what));
    expect(all(shallows).has('driftwood')).toBe(true);
    expect(all(shallows).has('coral')).toBe(false);
    expect(all(reef).has('coral')).toBe(true);
    expect(DESTINATIONS).toHaveLength(2);
  });

  test('collecting: clay and paint into the purse, decorations onto the island, what does not fit waits', () => {
    const s = withHarbour();
    const red = '#d8382f';
    const withHaul = { ...s, harbour: { ...s.harbour, haul: { to: 'shallows', finds: [{ who: 'c0', what: 'clay', amount: 5 }, { who: 'c0', what: red, amount: 2 }, { who: 'c1', what: 'driftwood', amount: 1 }] } } };
    const r = collectHaul(withHaul);
    expect(r.state.purse.clay).toBe(5);
    expect(r.state.purse.paint[red]).toBe(2);
    expect(r.state.island.items.some((d) => d.kind === 'driftwood')).toBe(true);
    expect(r.state.harbour.haul).toBeNull();
    const full = { ...withHaul, island: { ...withHaul.island, items: [...withHaul.island.items, ...Array.from({ length: 39 }, (_, i) => ({ id: `m${i}`, kind: 'mushroom' as const, x: 0, z: 0, size: 1, rot: 0 }))] } };
    const crowded = collectHaul(full);
    expect(crowded.kept).toEqual([{ who: 'c1', what: 'driftwood', amount: 1 }]);
    expect(crowded.state.harbour.haul!.finds).toEqual(crowded.kept);
    expect(crowded.state.purse.clay).toBe(5);
  });

  test('you collect the last haul before sailing again', () => {
    const s = withHarbour();
    const r = setSail({ ...s, harbour: { ...s.harbour, haul: { to: 'shallows', finds: [{ who: 'c0', what: 'clay', amount: 1 }] } } }, 'shallows', ['c0']);
    expect(r).toEqual({ why: 'haul' });
  });
});
