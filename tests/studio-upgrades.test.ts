import { describe, expect, test } from 'vitest';
import { advance, startMix } from '../src/studio/economy';
import { destination, setSail, tripTime } from '../src/studio/harbour';
import { cancelOrder, orderItem, ordersAllowed } from '../src/studio/lighthouse';
import { putAway, takeOut } from '../src/studio/storage';
import { bareGhost, newStudio, normaliseStudio, PRIMARIES, studioData, type StudioState } from '../src/studio/state';
import { levelOf, MIX_MAKES, nextUpgrade, upgrade, UPGRADES, WELL_EVERY } from '../src/studio/upgrades';
import { STEPS } from '../src/studio/merchant';

const { red, yellow } = PRIMARIES;
const at = (id: string, kind: 'well' | 'bowl' | 'harbour' | 'lighthouse', x: number, z: number) => ({ id, kind, x, z, size: 1, rot: 0 });

/** A studio with a well, the bowl, the harbour and the lighthouse, plenty of clay, and the merchant away at the coast. */
function built(clay = 5000): StudioState {
  const s = newStudio(0);
  return {
    ...s,
    seed: 2,
    lastSeen: 0,
    characters: [bareGhost({ id: 'a', personality: 'calm' }), bareGhost({ id: 'b', personality: 'shy' })],
    island: { radius: 7.5, items: [at('w', 'well', 2, 0), at('bowl', 'bowl', -2, 0), at('h', 'harbour', -7, 1), at('l', 'lighthouse', 4, -9)] },
    wellsBuilt: 1,
    purse: { clay, paint: { [red]: 4, [yellow]: 4 } },
    merchant: { ...s.merchant, here: false, wait: 900, visits: 3, paid: STEPS[1].paid, last: ['tree', 'rock', 'shell', 'mushroom'] },
  };
}
const item = (s: StudioState, id: string) => s.island.items.find((d) => d.id === id)!;

describe('upgrading', () => {
  test('two levels each, for clay, each dearer than the last, and nothing beyond', () => {
    for (const levels of Object.values(UPGRADES)) {
      expect(levels).toHaveLength(2);
      expect(levels[1].cost).toBeGreaterThan(levels[0].cost);
    }
    let s = built();
    expect(nextUpgrade(s, item(s, 'w'))).toMatchObject({ level: 1, cost: 100 });
    s = upgrade(s, 'w')!;
    expect(s.purse.clay).toBe(5000 - 100);
    expect(levelOf(s, item(s, 'w'))).toBe(1);
    s = upgrade(s, 'w')!;
    expect(s.purse.clay).toBe(5000 - 100 - 300);
    expect(nextUpgrade(s, item(s, 'w'))).toBeNull();
    expect(upgrade(s, 'w')).toBeNull();
  });

  test('not without the clay, and not things that have no upgrades', () => {
    const poor = built(99);
    expect(upgrade(poor, 'w')).toBeNull();
    const s = { ...built(), island: { ...built().island, items: [...built().island.items, { id: 't', kind: 'tree' as const, x: 0, z: 3, size: 1, rot: 0 }] } };
    expect(nextUpgrade(s, item(s, 't'))).toBeNull();
    expect(upgrade(s, 't')).toBeNull();
  });

  test('wells make paint quicker at each level', () => {
    expect(WELL_EVERY).toEqual([150, 115, 85]);
    const paints = (s: StudioState) => advance(s, 3000).yields.filter((y) => y.from === 'w').length;
    const s0 = built();
    const s1 = upgrade(s0, 'w')!;
    const s2 = upgrade(s1, 'w')!;
    expect(paints(s0)).toBe(Math.floor(3000 / 150));
    expect(paints(s1)).toBe(Math.floor(3000 / 115));
    expect(paints(s2)).toBe(Math.floor(3000 / 85));
  });

  test('an upgraded bowl makes bigger batches', () => {
    expect(MIX_MAKES).toEqual([2, 3, 4]);
    const batch = (s: StudioState) => {
      const mixing = startMix(s, red, yellow)!;
      return advance(mixing, 10).yields.filter((y) => y.from === 'bowl').length;
    };
    expect(batch(built())).toBe(2);
    expect(batch(upgrade(built(), 'bowl')!)).toBe(3);
    expect(batch(upgrade(upgrade(built(), 'bowl')!, 'bowl')!)).toBe(4);
  });

  test('the harbour: the bigger boat, then swift sails that make trips shorter', () => {
    const shallows = destination('shallows')!;
    let s = upgrade(built(), 'h')!;
    expect(s.harbour.level).toBe(1);
    expect(tripTime(s, shallows)).toBe(shallows.seconds);
    s = upgrade(s, 'h')!;
    expect(s.harbour.level).toBe(2);
    expect(tripTime(s, shallows)).toBe(Math.round((shallows.seconds * 2) / 3));
    const r = setSail(s, 'shallows', ['a']);
    if (!('state' in r)) throw new Error(r.why);
    expect(r.state.harbour.trip!.left).toBe(tripTime(s, shallows));
  });

  test('a well put away keeps its level', () => {
    const s = upgrade(built(), 'w')!;
    const stored = putAway(s, 'w')!;
    const back = takeOut(stored, 'well')!;
    expect(levelOf(back.state, back.item)).toBe(1);
  });

  test('levels survive a reload; rubbish is cleaned up', () => {
    const s = upgrade(upgrade(built(), 'l')!, 'w')!;
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(s)))).levels).toEqual({ l: 1, w: 1 });
    expect(normaliseStudio({ ...studioData(s), levels: { w: 9, x: -1, y: 'hi' } }).levels).toEqual({ w: 2 });
  });
});

describe('the lighthouse, upgraded', () => {
  const order = (s: StudioState, id: string) => {
    const r = orderItem(s, id);
    if (!('state' in r)) throw new Error(r.why);
    return r.state;
  };

  test('more orders between visits at each level, one of each thing', () => {
    let s = built();
    expect(ordersAllowed(s)).toBe(1);
    s = order(s, 'tree');
    expect(orderItem(s, 'rock')).toEqual({ why: 'busy' });
    s = upgrade(s, 'l')!;
    expect(ordersAllowed(s)).toBe(2);
    expect(orderItem(s, 'tree')).toEqual({ why: 'twice' });
    s = order(s, 'rock');
    expect(orderItem(s, 'shell')).toEqual({ why: 'busy' });
    s = order(upgrade(s, 'l')!, 'shell');
    expect(s.merchant.orders.map((o) => o.id)).toEqual(['tree', 'rock', 'shell']);
  });

  test('cancelling one of several gives back just that one', () => {
    const s = order(order(upgrade(built(), 'l')!, 'tree'), 'rock');
    const back = cancelOrder(s, 'tree')!;
    expect(back.merchant.orders.map((o) => o.id)).toEqual(['rock']);
    expect(back.purse.clay).toBe(s.purse.clay + s.merchant.orders[0].clay);
  });

  test('he brings all of them on his next visit', () => {
    const s = order(order(upgrade(built(), 'l')!, 'tree'), 'shell');
    const came = advance(s, 900);
    expect(came.visit).toBe('arrived');
    expect(came.delivered.map((i) => i.id).sort()).toEqual(['shell', 'tree']);
    expect(came.state.storage.map((d) => d.kind).sort()).toEqual(['shell', 'tree']);
    expect(came.state.merchant.orders).toEqual([]);
  });

  test('a save from when there was one order loads it as a list of one', () => {
    const old = { ...studioData(built()), merchant: { ...built().merchant, orders: undefined, deliveries: undefined, order: { id: 'tree', clay: 19 }, delivery: 'broom' } };
    const s = normaliseStudio(old);
    expect(s.merchant.orders).toEqual([{ id: 'tree', clay: 19 }]);
    expect(s.merchant.deliveries).toEqual(['broom']);
  });
});
