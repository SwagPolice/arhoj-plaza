import { describe, expect, test } from 'vitest';
import { advance, BOWL_COST, buyBowl, buyGhost, buyWell, comeBack, dip } from '../src/studio/economy';
import {
  buyItem, findable, giveClay, giveTrait, hasTrait, ITEMS, LINGER, NEXT_VISIT, nextStep, packBasket, RARITY, stepOf, STEPS, stock, tidyPickups,
} from '../src/studio/merchant';
import { mulberry32 } from '../src/util/random';
import { bareGhost, FIRST_VISIT, newStudio, PRIMARIES, type StudioState } from '../src/studio/state';

const { yellow, cobalt } = PRIMARIES;
/** A studio with a mixing bowl, ready for the merchant. */
const withBowl = (): StudioState => ({ ...buyBowl({ ...newStudio(0), seed: 3, purse: { clay: BOWL_COST, paint: {} } })!, lastSeen: 0 });
/** The merchant here with three of everything he can find so far, and plenty to spend. */
const visited = (clay = 500, paint: Record<string, number> = { [yellow]: 5, [cobalt]: 5 }): StudioState => {
  const s = advance(withBowl(), FIRST_VISIT).state;
  return { ...s, purse: { clay, paint }, merchant: { ...s.merchant, offers: ITEMS.map((i) => ({ id: i.id, left: 3 })) } };
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

  test('he stays 20 minutes, then leaves and comes back 1 to 2 hours later', () => {
    expect(STEPS[0].stay).toBe(20 * 60);
    let s = advance(withBowl(), FIRST_VISIT).state;
    const gone = advance(s, STEPS[0].stay);
    expect(gone.visit).toBe('left');
    s = gone.state;
    expect(s.merchant.wait).toBeGreaterThanOrEqual(NEXT_VISIT.min);
    expect(s.merchant.wait).toBeLessThanOrEqual(NEXT_VISIT.max);
    expect(advance(s, s.merchant.wait).visit).toBe('arrived');
  });

  test('his visits go on while you are away: he may be partway through a visit, or gone again', () => {
    const s = withBowl();
    const soon = comeBack(s, 120 * 1000).state; // came at 20 s, so 100 s of his stay are used up
    expect(soon.merchant.here).toBe(true);
    expect(soon.merchant.stay).toBeCloseTo(STEPS[0].stay - 100);
    const later = comeBack(s, (FIRST_VISIT + STEPS[0].stay + 60) * 1000).state; // he came and went
    expect(later.merchant.here).toBe(false);
    expect(later.merchant.visits).toBe(1);
  });

  test('coming back near the end of his visit, he lingers a few minutes so you can catch him', () => {
    const here = advance(withBowl(), FIRST_VISIT).state; // arrived, with his whole stay ahead
    const nearlyGone = { ...here, merchant: { ...here.merchant, stay: 61 }, lastSeen: 0 };
    const back = comeBack(nearlyGone, 60 * 1000).state; // a minute away: one second of his visit left
    expect(back.merchant.here).toBe(true);
    expect(back.merchant.stay).toBe(LINGER);
    const plenty = comeBack({ ...here, lastSeen: 0 }, 120 * 1000).state;
    expect(plenty.merchant.stay).toBeCloseTo(STEPS[0].stay - 120); // no change when he has time left
  });

  test('a long wait from the older, rarer visits is cut down to 2 hours', () => {
    const s = withBowl();
    const old = { ...s, merchant: { ...s.merchant, visits: 1, wait: 3 * 3600 } };
    expect(advance(old, 1).state.merchant.wait).toBeCloseTo(NEXT_VISIT.max - 1);
  });

  test('once everything is sold, he leaves at once and his time away starts', () => {
    const s = { ...visited(), merchant: { ...visited().merchant, offers: [{ id: 'rock', left: 1 }] } };
    const r = buyItem(s, 'rock');
    if (!('state' in r)) throw new Error(r.why);
    const next = advance(r.state, 0.016);
    expect(next.visit).toBe('left');
    expect(next.state.merchant.wait).toBeGreaterThanOrEqual(NEXT_VISIT.min);
    expect(advance(s, 0.016).visit).toBeNull(); // something left: he stays
  });

  test('he packs a new basket each visit and takes the leftovers away with him', () => {
    const here = advance(withBowl(), FIRST_VISIT).state;
    expect(here.merchant.offers).toHaveLength(STEPS[0].offers);
    const gone = advance(here, STEPS[0].stay).state;
    expect(gone.merchant.offers).toBeNull();
  });

  test('a long time away can hold several visits, and always ends in a sensible state', () => {
    const back = comeBack(withBowl(), 8 * 3600 * 1000).state;
    expect(back.merchant.visits).toBeGreaterThanOrEqual(3);
    expect(back.merchant.visits).toBeLessThanOrEqual(6);
    if (back.merchant.here) expect(back.merchant.stay).toBeLessThanOrEqual(STEPS[0].stay);
    else expect(back.merchant.wait).toBeLessThanOrEqual(NEXT_VISIT.max);
  });
});

describe('his basket', () => {
  test('4 different things at first, from what he can find, in small amounts by rarity', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const basket = packBasket(0, mulberry32(seed));
      expect(basket).toHaveLength(4);
      expect(new Set(basket.map((o) => o.id)).size).toBe(4);
      for (const o of basket) {
        const item = ITEMS.find((i) => i.id === o.id)!;
        expect(item.step).toBe(0);
        expect(o.left).toBeGreaterThanOrEqual(RARITY[item.rarity].min);
        expect(o.left).toBeLessThanOrEqual(RARITY[item.rarity].max);
      }
    }
  });

  test('one more kind once he reaches the coast, and coast things can come', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) {
      const basket = packBasket(1, mulberry32(seed));
      expect(basket).toHaveLength(5);
      basket.forEach((o) => seen.add(o.id));
    }
    expect(seen).toEqual(new Set(findable(1).map((i) => i.id)));
  });

  test('rare things turn up less often than common ones', () => {
    let rare = 0;
    let common = 0;
    for (let seed = 1; seed <= 400; seed++)
      for (const o of packBasket(0, mulberry32(seed))) {
        if (o.id === 'broom') rare++;
        if (o.id === 'tree') common++;
      }
    expect(rare).toBeLessThan(common);
  });

  test('he sells only what he brought, until it runs out', () => {
    const s = { ...visited(), merchant: { ...visited().merchant, offers: [{ id: 'rock', left: 1 }] } };
    expect(buyItem(s, 'tree')).toEqual({ why: 'stock' });
    const r = buyItem(s, 'rock');
    if (!('state' in r)) throw new Error(r.why);
    expect(stock(r.state)).toEqual([{ ...ITEMS.find((i) => i.id === 'rock')!, left: 0 }]);
    expect(buyItem(r.state, 'rock')).toEqual({ why: 'soldout' });
  });
});

describe('his shop', () => {
  test('buying a decoration takes clay, puts it in storage, and counts towards his trip', () => {
    const s = visited();
    const r = buyItem(s, 'tree');
    if (!('state' in r)) throw new Error(r.why);
    expect(r.state.purse.clay).toBe(500 - 15);
    expect(r.state.storage.map((d) => d.kind)).toEqual(['tree']);
    expect(r.state.island).toEqual(s.island); // you place it yourself
    expect(r.state.merchant.paid).toBe(15);
  });

  test('nothing is sold when he is away, too dear, or not brought; a full island is fine (it goes to storage)', () => {
    expect(buyItem({ ...visited(), merchant: { ...visited().merchant, here: false } }, 'rock')).toEqual({ why: 'away' });
    expect(buyItem(visited(5), 'rock')).toEqual({ why: 'cost' });
    expect(buyItem({ ...visited(), merchant: { ...visited().merchant, offers: [] } }, 'rock')).toEqual({ why: 'stock' });
    const full = { ...visited(), island: { radius: 5, items: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, kind: 'mushroom' as const, x: 0, z: 0, size: 1, rot: 0 })) } };
    expect('state' in buyItem(full, 'rock')).toBe(true);
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

  test('at 300 clay paid he reaches the coast and grows; gifts count', () => {
    let s = visited(1000);
    expect(nextStep(s)?.name).toBe('The coast');
    s = giveClay(s, 290)!;
    expect(stepOf(s)).toBe(0);
    s = giveClay(s, 10)!;
    expect(stepOf(s)).toBe(1);
    expect(STEPS[1].scale).toBeGreaterThan(STEPS[0].scale);
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
  test('a player who plays the loop meets the merchant within about 20 minutes', () => {
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
    expect(metAt).toBeLessThanOrEqual(20 * 60);
  });
});
