import { describe, expect, test } from 'vitest';
import {
  canPlace, canTurn, defaultLayout, footprint, ISLAND_SIZE, LAYOUT_VERSION, MAX_DECOR, maxSizeHere, minRadius, nearestFreeSpot, normaliseLayout,
  obstaclesFor, placeNew, SIZES,
  type Decor, type IslandLayout,
} from '../src/scene/layout';

// A layout exactly as saved by the first version of Decorate mode (2026-10-14). Never edit it.
const SAVED_V1 = {
  v: 1,
  radius: 9.4,
  items: [
    { id: 'pond-1', kind: 'pond', x: -2.8, z: 2.6, size: 1.3 },
    { id: 'tree-x1', kind: 'tree', x: 6.1, z: -1.2, size: 1.21 },
    { id: 'rock-x2', kind: 'rock', x: 0.4, z: -3.3, size: 0.42 },
    { id: 'mushroom-x3', kind: 'mushroom', x: 7.9, z: 2.1, size: 1 },
  ],
};

const tree = (x: number, z: number, size = 1): Decor => ({ id: `t${x},${z}`, kind: 'tree', x, z, size, rot: 0 });

describe('the default island', () => {
  test('is the island from before decorating existed', () => {
    const d = defaultLayout();
    expect(d.radius).toBe(7.5);
    expect(d.items.filter((i) => i.kind === 'tree')).toHaveLength(5);
    expect(d.items.filter((i) => i.kind === 'rock')).toHaveLength(3);
    expect(d.items.filter((i) => i.kind === 'pond')).toEqual([{ id: 'pond-1', kind: 'pond', x: -2.8, z: 2.6, size: 1.3, rot: 0 }]);
    expect(d.items.filter((i) => i.kind === 'mushroom')).toHaveLength(6);
  });

  test('loads back unchanged, and every object is in a valid spot', () => {
    const d = defaultLayout();
    expect(normaliseLayout(JSON.parse(JSON.stringify({ v: LAYOUT_VERSION, ...d })))).toEqual(d);
    for (const item of d.items) expect(canPlace(d, item, item.x, item.z)).toBe(true);
  });
});

describe('loading saved islands', () => {
  test('a layout saved by the first version still loads as it was (and nothing is turned)', () => {
    const { v: _, ...saved } = SAVED_V1;
    expect(normaliseLayout(SAVED_V1)).toEqual({ ...saved, items: saved.items.map((i) => ({ ...i, rot: 0 })) });
  });

  test('turns are kept between 0 and a full turn', () => {
    const l = normaliseLayout({ radius: 8, items: [{ id: 'r', kind: 'rock', x: 0, z: 0, size: 0.4, rot: 7 }, { id: 's', kind: 'rock', x: 2, z: 0, size: 0.4, rot: -1 }] });
    expect(l.items.map((i) => i.rot)).toEqual([0.72, 5.28]);
  });

  test('nothing or rubbish gives the default island', () => {
    expect(normaliseLayout(null)).toEqual(defaultLayout());
    expect(normaliseLayout('hello')).toEqual(defaultLayout());
  });

  test('a newer version: unknown objects are left out, the rest loads', () => {
    const l = normaliseLayout({ v: LAYOUT_VERSION + 1, radius: 8, items: [{ kind: 'castle', x: 0, z: 0 }, { id: 'r', kind: 'rock', x: 1, z: 1, size: 0.4 }] });
    expect(l.items).toEqual([{ id: 'r', kind: 'rock', x: 1, z: 1, size: 0.4, rot: 0 }]);
  });

  test('out-of-range sizes are clamped and stray objects pulled back onto the island', () => {
    const l = normaliseLayout({ radius: 99, items: [{ id: 'a', kind: 'tree', x: 30, z: 0, size: 9 }] });
    expect(l.radius).toBe(ISLAND_SIZE.max);
    const [t] = l.items;
    expect(t.size).toBe(1.6);
    expect(Math.hypot(t.x, t.z) + footprint(t)).toBeLessThanOrEqual(l.radius);
  });

  test('duplicate ids are made unique, and there are never more than the maximum objects', () => {
    const items = Array.from({ length: MAX_DECOR + 5 }, () => ({ id: 'same', kind: 'mushroom', x: 0, z: 0, size: 1 }));
    const l = normaliseLayout({ radius: 8, items });
    expect(l.items).toHaveLength(MAX_DECOR);
    expect(new Set(l.items.map((i) => i.id)).size).toBe(MAX_DECOR);
  });
});

describe('placing things', () => {
  const empty: IslandLayout = { radius: 7, items: [] };

  test('big things may not overlap each other or hang off the edge', () => {
    const layout = { ...empty, items: [tree(0, 0)] };
    expect(canPlace(layout, tree(5, 5), 0.5, 0)).toBe(false); // on top of the other tree
    expect(canPlace(layout, tree(5, 5), 3, 0)).toBe(true);
    expect(canPlace(layout, tree(5, 5), 6.6, 0)).toBe(false); // over the rim
  });

  test('mushrooms may sit right next to a tree, but not inside it', () => {
    const layout = { ...empty, items: [tree(0, 0)] };
    const m: Decor = { id: 'm', kind: 'mushroom', x: 0, z: 0, size: 1, rot: 0 };
    expect(canPlace(layout, m, 0.8, 0)).toBe(true);
    expect(canPlace(layout, m, 0.3, 0)).toBe(false);
  });

  test('new things land on a free spot, until the island is full', () => {
    let layout: IslandLayout = { radius: ISLAND_SIZE.min, items: [] };
    let placed = 0;
    for (;;) {
      const item = placeNew(layout, 'pond');
      if (!item) break;
      expect(canPlace(layout, item, item.x, item.z)).toBe(true);
      layout = { ...layout, items: [...layout.items, item] };
      placed++;
    }
    expect(placed).toBeGreaterThan(0);
    expect(placed).toBeLessThan(MAX_DECOR);
  });

  test('dropping on a blocked spot lands on the nearest free spot instead', () => {
    // A tree dropped among mushrooms and next to another tree.
    const mush = (x: number, z: number): Decor => ({ id: `m${x},${z}`, kind: 'mushroom', x, z, size: 1, rot: 0 });
    const layout: IslandLayout = { radius: 7, items: [tree(0, 0), mush(2, 0.3), mush(2.3, -0.4), mush(1.6, -0.2)] };
    const moving = tree(-4, -4);
    const spot = nearestFreeSpot(layout, moving, 1.9, 0)!;
    expect(canPlace(layout, moving, spot.x, spot.z)).toBe(true);
    expect(Math.hypot(spot.x - 1.9, spot.z)).toBeLessThan(1.5); // close by, not across the island
    // A free spot is kept as is.
    expect(nearestFreeSpot(layout, moving, -3, 3)).toEqual({ x: -3, z: 3 });
  });

  test('when nothing fits anywhere, there is no spot', () => {
    const full: IslandLayout = { radius: ISLAND_SIZE.min, items: [{ id: 'p', kind: 'pond', x: 0, z: 0, size: 2, rot: 0 }] };
    expect(nearestFreeSpot(full, { id: 'q', kind: 'pond', x: 0, z: 0, size: 2, rot: 0 }, 1, 1)).toBeNull();
  });

  test('things can only grow as big as the space around them allows', () => {
    const a = tree(0, 0, 1);
    const layout: IslandLayout = { radius: 9, items: [a, tree(1.8, 0, 1.4)] }; // a big neighbour close by
    const max = maxSizeHere(layout, a);
    expect(max).toBeLessThan(SIZES.tree.max);
    expect(canPlace(layout, { ...a, size: max }, 0, 0)).toBe(true);
    expect(canPlace(layout, { ...a, size: max + 0.05 }, 0, 0)).toBe(false);
    expect(maxSizeHere({ radius: 9, items: [a] }, a)).toBe(SIZES.tree.max); // nothing nearby: full size
  });

  test('only things that look different when turned can be turned', () => {
    expect(canTurn('rock')).toBe(true);
    expect(['tree', 'pond', 'mushroom'].some((k) => canTurn(k as Decor['kind']))).toBe(false);
  });

  test('the island can only shrink as far as its furthest object allows', () => {
    const layout = { radius: 10, items: [tree(8, 0, 1)] };
    expect(minRadius(layout)).toBeCloseTo(8 + 0.7 + 0.2, 1);
    expect(minRadius({ radius: 10, items: [] })).toBe(ISLAND_SIZE.min);
  });

  test('characters walk around trees, ponds and rocks, but through mushrooms', () => {
    const obstacles = obstaclesFor(defaultLayout());
    expect(obstacles).toHaveLength(9); // 1 pond, 5 trees, 3 rocks
  });
});
