import { describe, expect, test } from 'vitest';
import { advance, BOWL_COST, buyBowl, buyGhost, buyWell, comeBack, dip } from '../src/studio/economy';
import { buyItem, giveClay, giveTrait, hasTrait, ITEMS, NEXT_VISIT, nextStep, stepOf, STEPS, stock, tidyPickups } from '../src/studio/merchant';
import { bareGhost, FIRST_VISIT, newStudio, PRIMARIES, type StudioState } from '../src/studio/state';

const { yellow, cobalt } = PRIMARIES;
/** A studio with a mixing bowl, ready for the merchant. */
const withBowl = (): StudioState => ({ ...buyBowl({ ...newStudio(0), seed: 3, purse: { clay: BOWL_COST, paint: {} } })!, lastSeen: 0 });
/** The merchant here, and plenty to spend. */
const visited = (clay = 500, paint: Record<string, number> = { [yellow]: 5, [cobalt]: 5 }): StudioState => {
  const s = advance(withBowl(), FIRST_VISIT).state;
  return { ...s, purse: { clay, paint } };
};

describe('his visits', () => {
  test('he only comes once there is a mixing bowl, about 20 s after', () => {
    expect(advance({ ...newStudio(0), seed: 3 }, 3600).state.merchant.here).toBe(false);
    const s = withBowl();
    expect(advance(s, FIRST_VISIT - 1).visit).toBeNull();
    const r = advance(s, FIRST_VISIT);
    expect(r.visit).toBe('arrived');
    expect(r.state.merchant).toMatchObject({ here: true, visits: 1, stay: STEPS[0].stay });
  });

  test('he stays a few minutes of play, then leaves and comes back 8 to 20 minutes later', () => {
    let s = advance(withBowl(), FIRST_VISIT).state;
    const gone = advance(s, STEPS[0].stay);
    expect(gone.visit).toBe('left');
    s = gone.state;
    expect(s.merchant.wait).toBeGreaterThanOrEqual(NEXT_VISIT.min);
    expect(s.merchant.wait).toBeLessThanOrEqual(NEXT_VISIT.max);
    expect(advance(s, s.merchant.wait).visit).toBe('arrived');
  });

  test('if he comes while you are away, he waits for you (his stay only runs while you play)', () => {
    const s = withBowl();
    const back = comeBack(s, 8 * 3600 * 1000).state;
    expect(back.merchant.here).toBe(true);
    expect(back.merchant.stay).toBe(STEPS[0].stay);
  });
});

describe('his shop', () => {
  test('buying a decoration takes clay, places it on the island, and counts towards his trip', () => {
    const s = visited();
    const r = buyItem(s, 'tree');
    if (!('state' in r)) throw new Error(r.why);
    expect(r.state.purse.clay).toBe(500 - 15);
    expect(r.state.island.items.find((d) => d.id === r.placed)?.kind).toBe('tree');
    expect(r.state.merchant.paid).toBe(15);
  });

  test('nothing is sold when he is away, too dear, not brought yet, or with no room', () => {
    expect(buyItem({ ...visited(), merchant: { ...visited().merchant, here: false } }, 'rock')).toEqual({ why: 'away' });
    expect(buyItem(visited(5), 'rock')).toEqual({ why: 'cost' });
    expect(buyItem(visited(), 'shell')).toEqual({ why: 'stock' }); // the coast isn't reached yet
    const full = { ...visited(), island: { radius: 5, items: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, kind: 'mushroom' as const, x: 0, z: 0, size: 1, rot: 0 })) } };
    expect(buyItem(full, 'rock')).toEqual({ why: 'room' });
  });

  test('rarer things also take paint', () => {
    const s = visited(500, { [yellow]: 1 });
    const id = s.characters[0].id;
    expect(buyItem(s, 'broom', id)).toEqual({ why: 'cost' }); // the broom needs 2 yellow
    const r = buyItem({ ...s, purse: { clay: 500, paint: { [yellow]: 2 } } }, 'broom', id);
    if (!('state' in r)) throw new Error(r.why);
    expect(r.state.purse).toEqual({ clay: 440, paint: { [yellow]: 0 } });
    expect(hasTrait(r.state, id, 'tidy')).toBe(true);
  });

  test('the broom makes someone Tidy once, and only someone who lives here', () => {
    const s = visited();
    const id = s.characters[0].id;
    expect(buyItem(s, 'broom', 'nobody')).toEqual({ why: 'who' });
    const tidy = giveTrait(s, id, 'tidy')!;
    expect(giveTrait(tidy, id, 'tidy')).toBeNull();
  });

  test('at 300 clay paid he reaches the coast, grows, and brings shells and sea glass; gifts count', () => {
    let s = visited(1000);
    expect(stock(s).map((i) => i.id)).not.toContain('shell');
    expect(nextStep(s)?.name).toBe('The coast');
    s = giveClay(s, 290)!;
    expect(stepOf(s)).toBe(0);
    s = giveClay(s, 10)!;
    expect(stepOf(s)).toBe(1);
    expect(STEPS[1].scale).toBeGreaterThan(STEPS[0].scale);
    expect(stock(s).map((i) => i.id)).toEqual(ITEMS.map((i) => i.id));
    expect(nextStep(s)).toBeNull();
    expect(giveClay({ ...s, purse: { clay: 5, paint: {} } }, 10)).toBeNull();
  });
});

describe('Tidy', () => {
  test('picks up only the drops within reach', () => {
    const ground = [{ id: 'near', x: 1, z: 0 }, { id: 'far', x: 4, z: 0 }];
    expect(tidyPickups(ground, [{ x: 0, z: 0 }])).toEqual(['near']);
    expect(tidyPickups(ground, [])).toEqual([]);
  });
});

describe('pacing', () => {
  test('a player who plays the loop meets the merchant within about 15 minutes', () => {
    let s: StudioState = { ...newStudio(0), seed: 11 };
    let metAt = -1;
    for (let t = 1; t <= 30 * 60 && metAt < 0; t++) {
      const r = advance(s, 1);
      s = r.state;
      if (r.visit === 'arrived') metAt = t;
      for (const y of r.yields) s = { ...s, purse: y.what === 'clay' ? { ...s.purse, clay: s.purse.clay + y.amount } : { ...s.purse, paint: { ...s.purse.paint, [y.what]: (s.purse.paint[y.what] ?? 0) + y.amount } } };
      if (!s.wellsBuilt) s = buyWell(s) ?? (s.ghostsMade < 3 ? buyGhost(s, bareGhost({ personality: 'curious' })) ?? s : s);
      else if (!s.characters.some((c) => c.layers.length)) {
        const colour = Object.keys(s.purse.paint).find((c) => s.purse.paint[c] > 0);
        if (colour) s = dip(s, s.characters[0].id, colour)!;
      } else s = buyBowl(s) ?? s;
    }
    expect(metAt).toBeGreaterThan(0);
    expect(metAt).toBeLessThanOrEqual(15 * 60);
  });
});
