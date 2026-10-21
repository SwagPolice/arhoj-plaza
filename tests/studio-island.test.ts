import { describe, expect, test } from 'vitest';
import { growIsland, ISLAND_COSTS, ISLAND_SIZES, islandCost, islandStep } from '../src/studio/economy';
import { comfortHere } from '../src/studio/happiness';
import { buyHarbour } from '../src/studio/harbour';
import { footprint } from '../src/scene/layout';
import { newStudio, type StudioState } from '../src/studio/state';

const rich = (clay = 10_000): StudioState => ({ ...newStudio(0), purse: { clay, paint: {} } });

describe('island expansion', () => {
  test('five sizes, each next one costing more', () => {
    expect(ISLAND_SIZES).toEqual([5, 6, 7.5, 9, 11]);
    expect(ISLAND_COSTS).toEqual([150, 400, 900, 2000]);
  });

  test('growing takes clay and steps the island up, until it is as big as it gets', () => {
    let s = rich(3450);
    const radii = [s.island.radius];
    for (let i = 0; i < 4; i++) {
      s = growIsland(s)!;
      radii.push(s.island.radius);
    }
    expect(radii).toEqual(ISLAND_SIZES);
    expect(s.purse.clay).toBe(0);
    expect(islandCost(s)).toBeNull();
    expect(growIsland({ ...s, purse: { clay: 99_999, paint: {} } })).toBeNull();
  });

  test('not without enough clay', () => {
    expect(growIsland(rich(149))).toBeNull();
  });

  test('everything stays put, except the harbour, which moves out to the new edge at the same spot', () => {
    let s = rich();
    s = { ...s, merchant: { ...s.merchant, visits: 1 }, island: { ...s.island, items: [{ id: 'tree-a', kind: 'tree', x: 1, z: -1, size: 1, rot: 0 }] } };
    s = buyHarbour(s)!;
    const harbour = s.island.items.find((d) => d.kind === 'harbour')!;
    const grown = growIsland(s)!;
    expect(grown.island.items.find((d) => d.id === 'tree-a')).toEqual(s.island.items.find((d) => d.id === 'tree-a'));
    const moved = grown.island.items.find((d) => d.kind === 'harbour')!;
    expect(Math.atan2(moved.x, moved.z)).toBeCloseTo(Math.atan2(harbour.x, harbour.z), 2);
    expect(Math.hypot(moved.x, moved.z) + footprint(moved)).toBeCloseTo(grown.island.radius - 0.21, 1);
    expect(moved.rot).toBe(harbour.rot);
  });

  test('the size is worked out from a saved radius', () => {
    expect(islandStep(rich())).toBe(0);
    expect(islandStep({ ...rich(), island: { radius: 7.5, items: [] } })).toBe(2);
    expect(islandCost({ ...rich(), island: { radius: 9, items: [] } })).toBe(2000);
  });

  test('a bigger island has more room to wander', () => {
    const here = { x: 0, z: 0 };
    expect(comfortHere({ radius: 9, items: [] }, here, 12)).toBeGreaterThan(comfortHere({ radius: 5, items: [] }, here, 12));
  });
});
