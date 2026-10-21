import { describe, expect, test } from 'vitest';
import { advance, BOWL_COST, buyBowl, comeBack, dropOnGround } from '../src/studio/economy';
import { FIRST_STAR, nextGap, SHARDS, STAR_GAP, stepStars, WHITE } from '../src/studio/stars';
import { MAX_GROUND, newStudio, normaliseStudio, studioData, type StudioState } from '../src/studio/state';
import { mulberry32 } from '../src/util/random';

const withBowl = (): StudioState => ({ ...buyBowl({ ...newStudio(0), seed: 4, purse: { clay: BOWL_COST, paint: {} } })!, lastSeen: 0 });
const shards = (ys: { star?: boolean }[]) => ys.filter((y) => y.star).length;

describe('shooting stars', () => {
  test('the first falls about 20 minutes after the mixing bowl, and not before there is one', () => {
    expect(shards(advance({ ...newStudio(0), seed: 4 }, 3600).yields)).toBe(0);
    const s = withBowl();
    expect(shards(advance(s, FIRST_STAR - 1).yields)).toBe(0);
    const r = advance(s, FIRST_STAR);
    expect(r.stars).toBe(1);
    const n = shards(r.yields);
    expect(n).toBeGreaterThanOrEqual(SHARDS.min);
    expect(n).toBeLessThanOrEqual(SHARDS.max);
    expect(r.yields.filter((y) => y.star).every((y) => y.what === WHITE && y.amount === 1)).toBe(true);
    expect(r.state.stars.seen).toBe(1);
  });

  test('after that: never within 3 hours, mostly within 6, always within 8', () => {
    const gaps = Array.from({ length: 2000 }, (_, i) => nextGap(mulberry32(i + 1)));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(STAR_GAP.min);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(STAR_GAP.max);
    const within6 = gaps.filter((g) => g <= STAR_GAP.likely).length / gaps.length;
    expect(within6).toBeGreaterThan(0.75);
    expect(within6).toBeLessThan(0.95);
  });

  test('stars fall while you are away too, and their shards wait on the island even when it is full', () => {
    const s = { ...withBowl(), ground: Array.from({ length: MAX_GROUND }, (_, i) => ({ id: `g${i}`, x: 0, z: 0, what: 'clay', amount: 1 })) };
    const back = comeBack(s, (FIRST_STAR + 60) * 1000);
    expect(back.ground.filter((y) => y.star).length).toBeGreaterThanOrEqual(SHARDS.min);
    const { state } = dropOnGround(s, back.ground, () => ({ x: 1, z: 1 }));
    expect(state.ground.filter((d) => d.star).length).toBeGreaterThanOrEqual(SHARDS.min); // past the 30-drop limit
  });

  test('a long time away can bring two stars, never more than the gaps allow', () => {
    const r = stepStars({ wait: 10, seen: 1 }, true, 8 * 3600, mulberry32(2));
    expect(r.shards.length).toBeGreaterThanOrEqual(1);
    expect(r.shards.length).toBeLessThanOrEqual(3);
  });

  test('shards and the star timer survive a reload; shards do not count towards the limit', () => {
    const s = { ...withBowl(), stars: { wait: 500, seen: 2 } };
    const ground = [
      ...Array.from({ length: MAX_GROUND }, (_, i) => ({ id: `g${i}`, x: 0, z: 0, what: 'clay', amount: 1 })),
      { id: 'shard', x: 1, z: 1, what: WHITE, amount: 1, star: true },
    ];
    const loaded = normaliseStudio(JSON.parse(JSON.stringify(studioData({ ...s, ground }))), 5);
    expect(loaded.stars).toEqual({ wait: 500, seen: 2 });
    expect(loaded.ground).toHaveLength(MAX_GROUND + 1);
    expect(loaded.ground.at(-1)).toMatchObject({ id: 'shard', star: true });
  });
});
