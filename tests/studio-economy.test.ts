import { describe, expect, test } from 'vitest';
import {
  advance, AWAY_CAP, AWAY_SPEED, BOWL_COST, bowlOf, buyBowl, buyGhost, buyWell, collect, collectAway, comeBack, dip, dropOnGround,
  ghostCost, MIX_TIME, nextGoal, startMix, TIDY_AWAY, wellCost,
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
    const { yields } = advance(start('bouncy'), 600); // 10 min, one drop every 16 s
    expect(yields.every((y) => y.what === 'clay')).toBe(true);
    expect(total(yields)).toBeGreaterThanOrEqual(37);
    expect(total(yields)).toBeLessThanOrEqual(38);
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
    expect(total(yields, red)).toBeGreaterThan(5);
    expect(total(yields, red)).toBeLessThan(30); // a little paint, now and then
    expect(total(yields)).toBeGreaterThan(total(yields, red)); // still mostly clay
  });

  test('glaze wells make one of the three primary colours every two and a half minutes', () => {
    let s = { ...start(), purse: { clay: 100, paint: {} } };
    s = buyWell(s)!;
    const { yields, state } = advance(s, 750);
    const paints = yields.filter((y) => y.what !== 'clay');
    expect(paints).toHaveLength(5);
    expect(paints.every((y) => Object.values(PRIMARIES).includes(y.what as never))).toBe(true);
    expect(Object.values(state.wellTints)[0]).toBeTruthy(); // the water shows its last colour
  });
});

describe('coming back', () => {
  test('while you are away, nobody collects: what was made lies on the ground, as much as fits', () => {
    const s = start('bouncy');
    const back = comeBack(s, 24 * 3600 * 1000);
    expect(back.seconds).toBe(AWAY_CAP);
    expect(back.state.purse).toEqual(s.purse);
    expect(back.state.away).toBeNull();
    expect(back.ground).toHaveLength(MAX_GROUND);
    const short = comeBack(s, 10 * 60 * 1000); // 10 minutes away at a third of the speed
    expect(total(short.ground)).toBe(total(advance(s, 600, AWAY_SPEED).yields));
    expect(total(short.ground)).toBeLessThanOrEqual(13);
  });

  test('Tidy characters pick up to 60 drops an hour each while you are away: that is the card', () => {
    const s = start('bouncy');
    const id = s.characters[0].id;
    const tidy = { ...s, traits: { [id]: ['tidy' as const] } };
    const hour = comeBack(tidy, 3600 * 1000);
    const made = total(advance(tidy, 3600, AWAY_SPEED).yields);
    expect(hour.state.away!.clay).toBe(Math.min(made, TIDY_AWAY));
    expect(hour.state.purse.clay).toBe(0); // on the card until you collect it
    const collected = collectAway(hour.state);
    expect(collected.purse.clay).toBe(hour.state.away!.clay);
    const long = comeBack(tidy, 8 * 3600 * 1000);
    expect(long.state.away!.clay).toBeLessThanOrEqual(8 * TIDY_AWAY);
    expect(long.ground.length).toBeLessThanOrEqual(MAX_GROUND);
  });

  test('a clock that went backwards makes nothing, and a short break just carries on', () => {
    const s = { ...start(), lastSeen: 10_000_000 };
    expect(comeBack(s, 5_000_000).ground).toEqual([]);
    expect(comeBack(s, 10_030_000).ground).toEqual([]);
  });
});

describe('the ground and spending', () => {
  test('at most 30 drops lie around: a full island makes nothing more until you collect', () => {
    const s = start();
    const yields = Array.from({ length: MAX_GROUND + 5 }, () => ({ from: 'x', what: 'clay', amount: 1 }));
    const { state } = dropOnGround(s, yields, () => ({ x: 0, z: 0 }));
    expect(state.ground).toHaveLength(MAX_GROUND);
    expect(state.held).toEqual(s.held);
  });

  test('what an older save held back still comes out as you collect', () => {
    const s = { ...start(), held: { clay: 2, paint: {} } };
    const { state } = dropOnGround(s, [{ from: 'x', what: 'clay', amount: 1 }], () => ({ x: 0, z: 0 }));
    const after = collect(state, state.ground[0].id);
    expect(after.release).toEqual({ from: 'held', what: 'clay', amount: 1 });
    expect(after.state.held.clay).toBe(1);
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

  test('costs rise steeply, so the studio grows slowly', () => {
    const s = start();
    expect([1, 2, 3, 4, 5, 6].map((n) => ghostCost({ ...s, ghostsMade: n }))).toEqual([10, 15, 23, 34, 51, 76]);
    expect([0, 1, 2, 3].map((n) => wellCost({ ...s, wellsBuilt: n }))).toEqual([15, 60, 180, 540]);
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
    expect(back.purse.paint[mixResult(red, yellow)!]).toBe(2); // your own mix: straight into your purse
  });
});

describe('pacing (calm: tuned 2026-10-15)', () => {
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

  test('an hour of eager play keeps the counters calm: clay stays low as it gets spent, paint trickles in', () => {
    let s = start('curious', 11);
    let clay = 0;
    let paint = 0;
    let peak = 0;
    for (let t = 1; t <= 3600; t++) {
      const r = advance(s, 1);
      s = r.state;
      for (const y of r.yields) {
        if (y.what === 'clay') clay += y.amount;
        else paint += y.amount;
        s = { ...s, purse: y.what === 'clay' ? { ...s.purse, clay: s.purse.clay + y.amount } : { ...s.purse, paint: { ...s.purse.paint, [y.what]: (s.purse.paint[y.what] ?? 0) + y.amount } } };
      }
      peak = Math.max(peak, s.purse.clay);
      s = buyWell(s) ?? buyGhost(s, bareGhost({ personality: 'curious' })) ?? s; // spends everything it can
      const colour = Object.keys(s.purse.paint).find((c) => s.purse.paint[c] > 0);
      const bare = s.characters.find((c) => !c.layers.length);
      if (colour && bare) s = dip(s, bare.id, colour)!;
    }
    expect(peak).toBeLessThan(250); // the clay counter never runs away
    expect(clay).toBeLessThan(1000); // earned in total (before: well over 2,000)
    expect(paint).toBeLessThan(160); // with 9 dipped ghosts and 3 wells by the end; a lot less early on
  });

  test('first mixed colour within ~30 min', () => {
    const at = playToMix();
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(30 * 60);
  });

  for (const p of ['bouncy', 'calm', 'curious', 'shy'] as Personality[]) {
    test(`starting with a ${p} ghost: first well within ~8 min, first dip within ~11`, () => {
      const { wellAt, dipAt } = play(p);
      expect(wellAt).toBeGreaterThan(0);
      expect(wellAt).toBeLessThanOrEqual(8 * 60);
      expect(dipAt).toBeLessThanOrEqual(11 * 60);
    });
  }
});
