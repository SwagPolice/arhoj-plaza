import { describe, expect, test } from 'vitest';
import { advance, comeBack } from '../src/studio/economy';
import {
  BOOST, bestFriend, chatted, comfortHere, fadeLifts, friendship, happiness, hearts, LIFT_HALF, PET_EVERY, petted, settleComfort,
} from '../src/studio/happiness';
import { bareGhost, newStudio, type StudioState } from '../src/studio/state';
import type { Decor, DecorKind } from '../src/scene/layout';

const item = (kind: DecorKind, x: number, z: number): Decor => ({ id: `${kind}-${x}-${z}`, kind, x, z, size: 1, rot: 0 });
const island = (items: Decor[] = [], radius = 5) => ({ radius, items });
const studio = (n = 2): StudioState => ({
  ...newStudio(0),
  seed: 3,
  characters: Array.from({ length: n }, (_, i) => bareGhost({ id: `c${i}`, name: `C${i}`, personality: 'curious' })),
});

describe('comfort', () => {
  test('decorations nearby make a spot comfortable, more so when closer; buildings do not count', () => {
    const here = { x: 0, z: 0 };
    const bare = comfortHere(island(), here, 1);
    expect(comfortHere(island([item('tree', 1, 0)]), here, 1)).toBeGreaterThan(bare);
    expect(comfortHere(island([item('tree', 0.5, 0)]), here, 1)).toBeGreaterThan(comfortHere(island([item('tree', 2, 0)]), here, 1));
    expect(comfortHere(island([item('tree', 4, 0)]), here, 1)).toBe(bare); // too far
    expect(comfortHere(island([item('well', 0.5, 0), item('bowl', -0.5, 0)]), here, 1)).toBe(bare);
    const lots = island(Array.from({ length: 12 }, (_, i) => item('mushroom', Math.cos(i) * 0.5, Math.sin(i) * 0.5)));
    expect(comfortHere(lots, here, 1)).toBeCloseTo(0.6); // decorations at most 0.45, plus room
  });

  test('a crowded island is less comfortable', () => {
    expect(comfortHere(island(), { x: 0, z: 0 }, 20)).toBeLessThan(comfortHere(island(), { x: 0, z: 0 }, 3));
  });

  test('comfort eases in rather than jumping', () => {
    const s = studio();
    const a = settleComfort(s, 'c0', 0.5, 1);
    expect(a.mood.c0.comfort).toBeGreaterThan(0);
    expect(a.mood.c0.comfort).toBeLessThan(0.1);
    expect(settleComfort(s, 'c0', 0.5, 120).mood.c0.comfort).toBeCloseTo(0.5, 2);
  });
});

describe('lifts and friendships', () => {
  test('a chat lifts both, and they grow closer; closer friends lift more', () => {
    let s = chatted(studio(), 'c0', 'c1');
    expect(happiness(s, 'c0')).toBeCloseTo(0.05);
    expect(happiness(s, 'c1')).toBeCloseTo(0.05);
    expect(friendship(s, 'c1', 'c0')).toBeCloseTo(0.1);
    for (let i = 0; i < 9; i++) s = chatted(s, 'c0', 'c1');
    expect(friendship(s, 'c0', 'c1')).toBe(1);
    const before = s.mood.c0.lift;
    s = chatted(s, 'c0', 'c1');
    expect(s.mood.c0.lift - before).toBeCloseTo(0.1); // a close friend lifts twice as much
  });

  test('lifts fade by half every five minutes, also while you are away', () => {
    const s = { ...studio(), mood: { c0: { comfort: 0.2, lift: 0.4, petted: 0 } } };
    expect(fadeLifts(s.mood, LIFT_HALF).c0.lift).toBeCloseTo(0.2);
    expect(fadeLifts(s.mood, LIFT_HALF).c0.comfort).toBe(0.2); // comfort stays
    const back = comeBack({ ...s, lastSeen: 0 }, 15 * 60 * 1000).state;
    expect(back.mood.c0.lift).toBeCloseTo(0.05);
  });

  test('taps count as attention at most once every ten minutes', () => {
    const s = petted(studio(), 'c0', 1_000_000);
    expect(s.mood.c0.lift).toBeCloseTo(0.05);
    expect(petted(s, 'c0', 1_000_000 + 1000)).toBe(s);
    expect(petted(s, 'c0', 1_000_000 + PET_EVERY).mood.c0.lift).toBeCloseTo(0.1);
  });

  test('a best friend once they are properly close', () => {
    let s = studio(3);
    for (let i = 0; i < 3; i++) s = chatted(s, 'c0', 'c1');
    expect(bestFriend(s, 'c0')).toBeNull();
    for (let i = 0; i < 5; i++) s = chatted(s, 'c0', 'c2'); // five chats make them close (0.5)
    expect(bestFriend(s, 'c0')).toBe('c2');
    expect(bestFriend(s, 'c2')).toBe('c0');
  });
});

describe('what happiness does', () => {
  test('capped at 1, shown as 1 to 3 hearts', () => {
    const s = { ...studio(), mood: { c0: { comfort: 0.6, lift: 0.9, petted: 0 } } };
    expect(happiness(s, 'c0')).toBe(1);
    expect([0, 0.3, 0.34, 0.66, 0.67, 1].map(hearts)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  test('happy characters drop up to 25% faster, never slower', () => {
    const plain = studio(1);
    const happy = { ...plain, mood: { c0: { comfort: 0.6, lift: 0.4, petted: 0 } } };
    const count = (s: StudioState) => advance(s, 3600).yields.filter((y) => y.from === 'c0').length;
    const ratio = count(happy) / count(plain);
    expect(ratio).toBeGreaterThan(1 + BOOST - 0.05);
    expect(ratio).toBeLessThan(1 + BOOST + 0.05);
  });
});
