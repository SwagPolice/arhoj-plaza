import { describe, expect, test } from 'vitest';
import {
  advance, AWAY_CAP, AWAY_SPEED, BOWL_COST, bowlOf, buyBowl, buyGhost, buyWell, collect, collectAway, comeBack, dip, dropOnGround,
  ghostCost, MIX_TIME, nextGoal, PAINT_SHARE, scrape, startMix, TIDY_AWAY, wellCost,
} from '../src/studio/economy';
import { CLAY_HEIGHT, defaultLayer, REACH } from '../src/character/recipe';
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

  test('one Tidy character keeps up with about two ordinary ghosts while you are away', () => {
    const base = start('curious');
    const [a] = base.characters;
    const two = { ...base, characters: [a, { ...a, id: 'b2' }], traits: { [a.id]: ['tidy' as const] } };
    const back = comeBack(two, 3600 * 1000);
    const made = total(advance(two, 3600, AWAY_SPEED).yields);
    expect(back.state.away!.clay).toBe(made);
    expect(back.ground).toHaveLength(0);
  });

  test('Tidy collects paint from the wells too, not only clay', () => {
    const base = buyWell({ ...start('bouncy'), purse: { clay: 100, paint: {} } })!;
    const [a] = base.characters;
    const busy = {
      ...base,
      characters: [a, ...['b', 'c', 'd'].map((id) => ({ ...a, id, personality: 'bouncy' as const }))],
      traits: { [a.id]: ['tidy' as const] },
    };
    const back = comeBack(busy, 4 * 3600 * 1000).state; // more made than Tidy can carry
    expect(Object.values(back.away!.paint).reduce((n, k) => n + k, 0)).toBeGreaterThan(0);
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
    expect(dip(dipped, dipped.characters[0].id, PRIMARIES.red)).toBeNull(); // no paint left
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

describe('layered dipping', () => {
  const { red, yellow, cobalt } = PRIMARIES;
  const rich = (): StudioState => ({ ...start(), purse: { clay: 0, paint: { [red]: 5, [yellow]: 5, [cobalt]: 5 } } });
  const id = (s: StudioState) => s.characters[0].id;

  test('up to three layers, each over the last, each for one paint', () => {
    let s = rich();
    s = dip(s, id(s), red)!;
    s = dip(s, id(s), yellow)!;
    s = dip(s, id(s), cobalt)!;
    expect(s.characters[0].layers.map((l) => l.colour)).toEqual([red, yellow, cobalt]);
    expect(s.purse.paint).toEqual({ [red]: 4, [yellow]: 4, [cobalt]: 4 });
    expect(dip(s, id(s), red)).toBeNull(); // three is the most
  });

  test('how far a dip reaches, and its edge: the first sets how much clay shows at the foot, later ones how far down', () => {
    let s = rich();
    s = dip(s, id(s), red, { depth: 1, edge: 'wavy' })!;
    expect(s.characters[0].clayHeight).toBe(CLAY_HEIGHT.min); // all the way down
    expect(s.characters[0].layers[0]).toMatchObject({ colour: red, edge: 'wavy', finish: 'glossy', pattern: 'plain' });
    s = dip(s, id(s), yellow, { depth: 0, edge: 'drips' })!;
    expect(s.characters[0].layers[1]).toMatchObject({ reach: REACH.min, edge: 'drips' });
    const fresh = rich();
    expect(dip(fresh, id(fresh), red, { depth: 0 })!.characters[0].clayHeight).toBe(CLAY_HEIGHT.max);
    expect(dip(fresh, id(fresh), red)!.characters[0].clayHeight).toBe(fresh.characters[0].clayHeight); // no shape: keeps its foot
  });

  test('scraping takes the top layer off for free, without giving the paint back', () => {
    let s = rich();
    s = dip(dip(s, id(s), red)!, id(s), yellow)!;
    const scraped = scrape(s, id(s))!;
    expect(scraped.characters[0].layers.map((l) => l.colour)).toEqual([red]);
    expect(scraped.purse).toEqual(s.purse);
    expect(scrape(scrape(scraped, id(s))!, id(s))).toBeNull(); // nothing left to scrape
  });

  test('drops come in any of its colours, and more layers mean more paint', () => {
    const glazed = (colours: string[]): StudioState => {
      const s = start('bouncy', 3);
      return { ...s, characters: [{ ...s.characters[0], layers: colours.map((c) => defaultLayer(c)) }] };
    };
    const one = advance(glazed([red]), 20000).yields;
    const three = advance(glazed([red, yellow, cobalt]), 20000).yields;
    const paintShare = (ys: { what: string }[]) => ys.filter((y) => y.what !== 'clay').length / ys.length;
    for (const c of [red, yellow, cobalt]) expect(total(three, c)).toBeGreaterThan(0);
    expect(paintShare(one)).toBeCloseTo(PAINT_SHARE[1], 1);
    expect(paintShare(three)).toBeCloseTo(PAINT_SHARE[3], 1);
    expect(paintShare(three)).toBeGreaterThan(paintShare(one));
  });
});
