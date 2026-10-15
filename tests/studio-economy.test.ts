import { describe, expect, test } from 'vitest';
import {
  advance, AWAY_CAP, BOWL_COST, bowlOf, buyBowl, buyGhost, buyWell, collect, collectAway, comeBack, dip, dropOnGround, ghostCost,
  MIX_TIME, nextGoal, startMix, wellCost,
} from '../src/studio/economy';
import { mixResult } from '../src/studio/mixing';
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

describe('the mixing bowl', () => {
  const { red, yellow } = PRIMARIES;
  const withBowl = (paint: Record<string, number>) => buyBowl({ ...start(), purse: { clay: BOWL_COST, paint } })!;

  test('one bowl, for 40 clay', () => {
    expect(buyBowl({ ...start(), purse: { clay: BOWL_COST - 1, paint: {} } })).toBeNull();
    const s = withBowl({});
    expect(s.purse.clay).toBe(0);
    expect(bowlOf(s)).toBeTruthy();
    expect(buyBowl({ ...s, purse: { clay: 999, paint: {} } })).toBeNull();
  });

  test('mixing takes one of each paint, one mix at a time, and only with a bowl', () => {
    expect(startMix({ ...start(), purse: { clay: 0, paint: { [red]: 1, [yellow]: 1 } } }, red, yellow)).toBeNull();
    const s = withBowl({ [red]: 1, [yellow]: 1 });
    expect(startMix(s, red, red)).toBeNull(); // only one red
    const mixing = startMix(s, red, yellow)!;
    expect(mixing.purse.paint).toEqual({ [red]: 0, [yellow]: 0 });
    expect(startMix({ ...mixing, purse: s.purse }, red, yellow)).toBeNull(); // still stirring
  });

  test('after a few seconds of stirring, a new colour comes out and is remembered', () => {
    const mixing = startMix(withBowl({ [red]: 1, [yellow]: 1 }), red, yellow)!;
    const halfway = advance(mixing, MIX_TIME / 2);
    expect(halfway.mixed).toBeNull();
    const done = advance(halfway.state, MIX_TIME);
    const orange = mixResult(red, yellow)!;
    expect(done.mixed).toEqual({ a: red, b: yellow, made: orange });
    expect(done.yields.filter((y) => y.what === orange)).toHaveLength(2);
    expect(done.state.bowl).toBeNull();
    expect(done.state.discovered).toEqual([orange]);
  });

  test('a pair that makes nothing gives both paints back', () => {
    const done = advance(startMix(withBowl({ [red]: 2 }), red, red)!, MIX_TIME);
    expect(done.mixed!.made).toBeNull();
    expect(done.yields.filter((y) => y.back && y.what === red)).toHaveLength(2);
    expect(done.state.discovered).toEqual([]);
  });

  test('a mix left stirring finishes while you are away', () => {
    const mixing = { ...startMix(withBowl({ [red]: 1, [yellow]: 1 }), red, yellow)!, lastSeen: 0 };
    const back = comeBack(mixing, 3600 * 1000).state;
    expect(back.bowl).toBeNull();
    expect(back.away!.paint[mixResult(red, yellow)!]).toBe(2);
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

  // Then saves for the bowl and mixes the first pair of paints it owns that makes something.
  function playToMix() {
    let s = start('curious', 11);
    for (let t = 1; t <= 60 * 60; t++) {
      const r = advance(s, 1);
      s = r.state;
      if (r.mixed?.made) return t;
      for (const y of r.yields) s = { ...s, purse: y.what === 'clay' ? { ...s.purse, clay: s.purse.clay + y.amount } : { ...s.purse, paint: { ...s.purse.paint, [y.what]: (s.purse.paint[y.what] ?? 0) + y.amount } } };
      if (!s.wellsBuilt) s = buyWell(s) ?? (s.ghostsMade < 3 ? buyGhost(s, bareGhost({ personality: 'curious' })) ?? s : s);
      else if (!s.characters.some((c) => c.layers.length)) {
        const colour = Object.keys(s.purse.paint).find((c) => s.purse.paint[c] > 0);
        if (colour) s = dip(s, s.characters[0].id, colour)!;
      } else if (!bowlOf(s)) s = buyBowl(s) ?? s;
      else if (!s.bowl) {
        const owned = Object.keys(s.purse.paint).filter((c) => s.purse.paint[c] > 0);
        const pair = owned.flatMap((a) => owned.map((b) => [a, b])).find(([a, b]) => a !== b && mixResult(a, b));
        if (pair) s = startMix(s, pair[0], pair[1]) ?? s;
      }
    }
    return -1;
  }

  test('first mixed colour within ~30 min', () => {
    const at = playToMix();
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(30 * 60);
  });

  for (const p of ['bouncy', 'calm', 'curious', 'shy'] as Personality[]) {
    test(`starting with a ${p} ghost: first well within ~6.5 min, first dip within ~8`, () => {
      const { wellAt, dipAt } = play(p);
      expect(wellAt).toBeGreaterThan(0);
      expect(wellAt).toBeLessThanOrEqual(6.5 * 60);
      expect(dipAt).toBeLessThanOrEqual(8 * 60);
    });
  }
});
