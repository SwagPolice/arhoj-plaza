import { describe, expect, test } from 'vitest';
import {
  advance, AWAY_CAP, buyGhost, buyWell, collect, collectAway, comeBack, dip, dropOnGround, ghostCost, nextGoal, wellCost,
} from '../src/studio/economy';
import { bareGhost, MAX_GROUND, newStudio, PRIMARIES, type StudioState } from '../src/studio/state';
import type { Personality } from '../src/character/recipe';

const start = (personality: Personality = 'curious', seed = 7): StudioState => {
  const s = newStudio(0);
  return { ...s, seed, characters: [{ ...s.characters[0], personality }] };
};
const total = (ys: { what: string; amount: number }[], what = 'clay') => ys.filter((y) => y.what === what).reduce((n, y) => n + y.amount, 0);

describe('time passing', () => {
  test('the same save always plays out the same', () => {
    const s = start();
    const a = advance(s, 600);
    const b = advance(s, 600);
    expect(a.yields).toEqual(b.yields);
    expect(a.state).toEqual(b.state);
  });

  test('a bare ghost only makes clay, roughly at its personality\'s pace', () => {
    const { yields } = advance(start('bouncy'), 600); // 10 min, one drop every 8 s
    expect(yields.every((y) => y.what === 'clay')).toBe(true);
    expect(total(yields)).toBeGreaterThanOrEqual(74);
    expect(total(yields)).toBeLessThanOrEqual(75);
  });

  test('many small steps make the same as one big one', () => {
    let s = start();
    let small = 0;
    for (let i = 0; i < 600; i++) {
      const r = advance(s, 1);
      s = r.state;
      small += total(r.yields);
    }
    expect(Math.abs(small - total(advance(start(), 600).yields))).toBeLessThanOrEqual(1);
  });

  test('a dipped ghost sometimes drops its own colour', () => {
    const s = start();
    const red = PRIMARIES.red;
    const dipped = { ...s, characters: [{ ...s.characters[0], layers: [{ colour: red, finish: 'glossy' as const, pattern: 'plain' as const, patternColour: '#fffdf8', edge: 'clean' as const, reach: 0.5 }] }] };
    const { yields } = advance(dipped, 3600);
    expect(total(yields, red)).toBeGreaterThan(30);
    expect(total(yields)).toBeGreaterThan(total(yields, red)); // still mostly clay
  });

  test('glaze wells make one of the three primary colours every minute', () => {
    let s = { ...start(), purse: { clay: 100, paint: {} } };
    s = buyWell(s)!;
    const { yields, state } = advance(s, 600);
    const paints = yields.filter((y) => y.what !== 'clay');
    expect(paints).toHaveLength(10);
    expect(paints.every((y) => Object.values(PRIMARIES).includes(y.what as never))).toBe(true);
    expect(Object.values(state.wellTints)[0]).toBeTruthy(); // the water shows its last colour
  });
});

describe('coming back', () => {
  test('time away fills the "While you were away" card, capped at 8 hours', () => {
    const s = start();
    const day = comeBack(s, 24 * 3600 * 1000);
    expect(day.seconds).toBe(AWAY_CAP);
    expect(day.state.away!.clay).toBe(total(advance(s, AWAY_CAP).yields));
    expect(day.state.purse.clay).toBe(0); // not yet collected
    const collected = collectAway(day.state);
    expect(collected.purse.clay).toBe(day.state.away!.clay);
    expect(collected.away).toBeNull();
  });

  test('a clock that went backwards makes nothing, and a short break shows no card', () => {
    const s = { ...start(), lastSeen: 10_000_000 };
    expect(comeBack(s, 5_000_000).state.away).toBeNull();
    expect(comeBack(s, 10_030_000).state.away).toBeNull();
  });
});

describe('the ground and spending', () => {
  test('at most 30 drops lie around; the rest is held and comes out as you collect', () => {
    const s = start();
    const yields = Array.from({ length: MAX_GROUND + 5 }, () => ({ from: 'x', what: 'clay', amount: 1 }));
    const { state } = dropOnGround(s, yields, () => ({ x: 0, z: 0 }));
    expect(state.ground).toHaveLength(MAX_GROUND);
    expect(state.held.clay).toBe(5);
    const after = collect(state, state.ground[0].id);
    expect(after.state.purse.clay).toBe(1);
    expect(after.release).toEqual({ from: 'held', what: 'clay', amount: 1 });
    expect(after.state.held.clay).toBe(4);
  });

  test('nothing can be bought without enough, and nothing goes below zero', () => {
    const s = start();
    expect(buyGhost(s, bareGhost())).toBeNull();
    expect(buyWell(s)).toBeNull();
    expect(dip(s, s.characters[0].id, PRIMARIES.red)).toBeNull();
    const rich = { ...s, purse: { clay: ghostCost(s), paint: { [PRIMARIES.red]: 1 } } };
    const bought = buyGhost(rich, bareGhost())!;
    expect(bought.purse.clay).toBe(0);
    expect(bought.characters).toHaveLength(2);
    const dipped = dip(bought, bought.characters[0].id, PRIMARIES.red)!;
    expect(dipped.purse.paint[PRIMARIES.red]).toBe(0);
    expect(dipped.characters[0].layers[0].colour).toBe(PRIMARIES.red);
    expect(dip(dipped, dipped.characters[0].id, PRIMARIES.red)).toBeNull(); // one dip each, and no paint left
  });

  test('costs rise gently', () => {
    const s = start();
    expect(ghostCost(s)).toBe(10);
    expect(ghostCost({ ...s, ghostsMade: 3 })).toBe(20);
    expect([0, 1, 2, 3].map((n) => wellCost({ ...s, wellsBuilt: n }))).toEqual([20, 35, 55, 85]);
  });
});

describe('pacing (first guesses, to be tuned once played)', () => {
  // A player who taps every drop at once, buys a ghost whenever they can (up to 3) until the well, then dips.
  function play(personality: Personality) {
    let s = start(personality, 11);
    let wellAt = -1;
    let dipAt = -1;
    for (let t = 1; t <= 30 * 60 && dipAt < 0; t++) {
      const r = advance(s, 1);
      s = r.state;
      for (const y of r.yields) s = { ...s, purse: y.what === 'clay' ? { ...s.purse, clay: s.purse.clay + y.amount } : { ...s.purse, paint: { ...s.purse.paint, [y.what]: (s.purse.paint[y.what] ?? 0) + y.amount } } };
      if (wellAt < 0) {
        const well = buyWell(s);
        if (well) [s, wellAt] = [well, t];
        else if (s.ghostsMade < 3) s = buyGhost(s, bareGhost({ personality: 'curious' })) ?? s;
      } else {
        const colour = Object.keys(s.purse.paint).find((c) => s.purse.paint[c] > 0);
        const bare = s.characters.find((c) => !c.layers.length);
        if (colour && bare) [s, dipAt] = [dip(s, bare.id, colour)!, t];
      }
    }
    return { wellAt, dipAt, goal: nextGoal(s) };
  }

  for (const p of ['bouncy', 'calm', 'curious', 'shy'] as Personality[]) {
    test(`starting with a ${p} ghost: first well within ~6.5 min, first dip within ~8`, () => {
      const { wellAt, dipAt } = play(p);
      expect(wellAt).toBeGreaterThan(0);
      expect(wellAt).toBeLessThanOrEqual(6.5 * 60);
      expect(dipAt).toBeLessThanOrEqual(8 * 60);
    });
  }
});
