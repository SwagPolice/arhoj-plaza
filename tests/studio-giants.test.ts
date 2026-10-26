import { describe, expect, test } from 'vitest';
import { GIANT_CHANCE, GIANT_GAP, GIANT_KINDS, giantReward, giftFrom, rollGiant, sawGiant, takeGift } from '../src/studio/giants';
import { WHITE } from '../src/studio/stars';
import { newStudio, normaliseStudio, PRIMARIES, studioData, type StudioState } from '../src/studio/state';
import { mulberry32 } from '../src/util/random';

const studio = (): StudioState => ({ ...newStudio(0), purse: { clay: 0, paint: {} } });
const DAY = GIANT_GAP;

describe('when a giant rises', () => {
  test('never within a day of the last one', () => {
    const s = sawGiant(studio(), 'ghost', 1000);
    const always = () => 0; // every roll a "yes"
    expect(rollGiant(s, 1000 + DAY - 1, always)).toBeNull();
    expect(rollGiant(s, 1000 + DAY, always)).not.toBeNull();
  });

  test('about 3% of minutes once the day has passed, and straight away in a new studio', () => {
    const s = studio();
    expect(s.giants.next).toBe(0);
    const rand = mulberry32(5);
    let seen = 0;
    for (let i = 0; i < 20000; i++) if (rollGiant(s, 0, rand)) seen++;
    expect(seen / 20000).toBeCloseTo(GIANT_CHANCE, 2);
  });

  test("kinds you haven't met yet are more likely", () => {
    const s = sawGiant(sawGiant(studio(), 'ghost', 0), 'serpent', 0);
    const free = { ...s, giants: { ...s.giants, next: 0 } };
    const rand = mulberry32(9);
    const counts: Record<string, number> = { ghost: 0, serpent: 0, mushroom: 0 };
    for (let i = 0; i < 40000; i++) {
      const k = rollGiant(free, 0, rand);
      if (k) counts[k]++;
    }
    expect(counts.mushroom).toBeGreaterThan(counts.ghost * 2);
    expect(counts.mushroom).toBeGreaterThan(counts.serpent * 2);
  });

  test('seeing one puts it in the book and starts the day-long wait', () => {
    const s = sawGiant(studio(), 'serpent', 5000);
    expect(s.giants).toEqual({ next: 5000 + DAY, seen: ['serpent'], rewarded: false });
    expect(sawGiant(s, 'serpent', 9000).giants.seen).toEqual(['serpent']); // once each
  });
});

describe('gifts and the reward', () => {
  test("each kind's gift: clay from the ghost, a found colour from the serpent, white from the mushroom", () => {
    const rand = mulberry32(3);
    const ghost = giftFrom(studio(), 'ghost', rand);
    expect(ghost.clay).toBeGreaterThanOrEqual(20);
    expect(ghost.clay).toBeLessThanOrEqual(35);
    expect(giftFrom(studio(), 'mushroom', rand)).toEqual({ clay: 0, paint: { [WHITE]: 2 } });
    const coral = '#ee8f6b';
    const s = { ...studio(), discovered: [coral] };
    const serpent = giftFrom(s, 'serpent', rand);
    const [[colour, n]] = Object.entries(serpent.paint);
    expect([...Object.values(PRIMARIES), coral]).toContain(colour);
    expect([2, 3]).toContain(n);
    expect(takeGift(s, serpent).purse.paint[colour]).toBe(n);
  });

  test('seeing all three brings the serpent figurine, just once', () => {
    let s = studio();
    for (const k of GIANT_KINDS.slice(0, 2)) s = sawGiant(s, k, 0);
    expect(giantReward(s).given).toBe(false);
    s = sawGiant(s, 'mushroom', 0);
    const r = giantReward(s);
    expect(r.given).toBe(true);
    expect(r.state.storage.map((d) => d.kind)).toEqual(['figurine']);
    expect(giantReward(r.state).given).toBe(false);
  });

  test('survives a reload; rubbish is cleaned up', () => {
    const s = sawGiant(studio(), 'ghost', 777);
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(s)))).giants).toEqual(s.giants);
    expect(normaliseStudio({ ...studioData(s), giants: { next: -5, seen: ['ghost', 'kraken', 'ghost'], rewarded: 'yes' } }).giants)
      .toEqual({ next: 0, seen: ['ghost'], rewarded: false });
  });
});
