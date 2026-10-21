import { describe, expect, test } from 'vitest';
import { advance, buyBowl, growIsland, nextGoal } from '../src/studio/economy';
import {
  buyLighthouse, cancelOrder, handOver, lastBasket, LIGHTHOUSE_COST, lighthouseOf, lighthouseUnlocked, orderItem, orderPrice, waiting,
} from '../src/studio/lighthouse';
import { buyHarbour, harbourOf } from '../src/studio/harbour';
import { hasTrait, ITEMS, STEPS } from '../src/studio/merchant';
import { canStore } from '../src/studio/storage';
import { bareGhost, newStudio, PRIMARIES, type StudioState } from '../src/studio/state';
import { canMove } from '../src/scene/layout';
import { defaultLayer } from '../src/character/recipe';

const item = (id: string) => ITEMS.find((i) => i.id === id)!;

/** A studio whose merchant has reached the coast and is away, last bringing a tree, a broom and sea glass. */
function atCoast(clay = 2000): StudioState {
  const base = buyBowl({ ...newStudio(0), seed: 4, purse: { clay: 40, paint: {} } })!;
  return {
    ...base,
    lastSeen: 0,
    characters: [bareGhost({ id: 'a', name: 'A', personality: 'calm' }), bareGhost({ id: 'b', name: 'B', personality: 'shy' })],
    purse: { clay, paint: { [PRIMARIES.cobalt]: 3, [PRIMARIES.yellow]: 3 } },
    merchant: { ...base.merchant, here: false, wait: 600, visits: 3, paid: STEPS[1].paid, last: ['tree', 'broom', 'seaglass'] },
  };
}
const lit = (clay = 2000) => buyLighthouse(atCoast(clay))!;

describe('building the lighthouse', () => {
  test('only once the merchant reaches the coast, for 400 clay', () => {
    const s = atCoast();
    expect(lighthouseUnlocked(s)).toBe(true);
    expect(lighthouseUnlocked({ ...s, merchant: { ...s.merchant, paid: STEPS[1].paid - 1 } })).toBe(false);
    expect(buyLighthouse({ ...s, merchant: { ...s.merchant, paid: 0 } })).toBeNull();
    expect(buyLighthouse({ ...s, purse: { ...s.purse, clay: LIGHTHOUSE_COST - 1 } })).toBeNull();
    const built = buyLighthouse(s)!;
    expect(built.purse.clay).toBe(s.purse.clay - LIGHTHOUSE_COST);
    expect(buyLighthouse(built)).toBeNull(); // just the one
  });

  test('it stands on the edge, away from the harbour, and stays there (even as the island grows)', () => {
    const s = buyHarbour({ ...atCoast(), merchant: { ...atCoast().merchant } })!;
    const built = buyLighthouse(s)!;
    const l = lighthouseOf(built)!;
    const h = harbourOf(built)!;
    expect(Math.hypot(l.x - h.x, l.z - h.z)).toBeGreaterThan(s.island.radius); // the other side of the island
    expect(l.x).toBeGreaterThan(0); // the right side
    expect(canMove('lighthouse')).toBe(false);
    expect(canStore('lighthouse')).toBe(false);
    const grown = growIsland(built)!;
    const moved = lighthouseOf(grown)!;
    expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(Math.hypot(l.x, l.z));
  });

  test('it becomes a goal once unlocked, after mixing and dipping', () => {
    const s = atCoast(100);
    const settled: StudioState = {
      ...s, wellsBuilt: 1, purse: { clay: 100, paint: {} }, discovered: ['#000000'],
      characters: s.characters.map((c) => ({ ...c, layers: [{ ...defaultLayer(), colour: PRIMARIES.cobalt }] })), // everyone dipped
      merchant: { ...s.merchant, visits: 0 }, // (no harbour goal)
    };
    expect(nextGoal(settled)).toBe(`Next: Lighthouse, ${LIGHTHOUSE_COST - 100} more clay`);
  });
});

describe('ordering', () => {
  test("from his last basket, sold out or not: his price plus 25% clay, paint the same, and it counts towards his trip", () => {
    const s = lit();
    expect(lastBasket(s).map((i) => i.id)).toEqual(['tree', 'broom', 'seaglass']);
    expect(orderPrice(item('tree'))).toEqual({ id: 'tree', clay: Math.ceil(item('tree').clay * 1.25) });
    expect(orderPrice(item('seaglass'))).toEqual({ id: 'seaglass', clay: 19, paint: { colour: PRIMARIES.cobalt, n: 1 } });
    const r = orderItem(s, 'seaglass');
    if (!('state' in r)) throw new Error(r.why);
    expect(r.state.purse.clay).toBe(s.purse.clay - 19);
    expect(r.state.purse.paint[PRIMARIES.cobalt]).toBe(2);
    expect(r.state.merchant.paid).toBe(s.merchant.paid + 19);
    expect(r.state.merchant.order).toEqual({ id: 'seaglass', clay: 19, paint: { colour: PRIMARIES.cobalt, n: 1 } });
  });

  test('one order between visits, only while he is away, only what he last brought, and only with a lighthouse', () => {
    const s = lit();
    const once = orderItem(s, 'tree');
    if (!('state' in once)) throw new Error(once.why);
    expect(orderItem(once.state, 'seaglass')).toEqual({ why: 'busy' });
    expect(orderItem({ ...s, merchant: { ...s.merchant, here: true } }, 'tree')).toEqual({ why: 'here' });
    expect(orderItem(s, 'shell')).toEqual({ why: 'stock' });
    expect(orderItem(atCoast(), 'tree')).toEqual({ why: 'lighthouse' });
    expect(orderItem(lit(LIGHTHOUSE_COST + 5), 'tree')).toEqual({ why: 'cost' });
  });

  test('cancelling gives everything back', () => {
    const s = lit();
    const r = orderItem(s, 'seaglass');
    if (!('state' in r)) throw new Error(r.why);
    const back = cancelOrder(r.state)!;
    expect(back.purse).toEqual(s.purse);
    expect(back.merchant).toEqual(s.merchant);
    expect(cancelOrder(back)).toBeNull();
  });
});

describe('delivery', () => {
  test('on his next visit, a decoration goes into storage', () => {
    const r = orderItem(lit(), 'seaglass');
    if (!('state' in r)) throw new Error(r.why);
    const before = advance(r.state, 599);
    expect(before.state.merchant.order).not.toBeNull(); // not yet
    const came = advance(before.state, 1);
    expect(came.visit).toBe('arrived');
    expect(came.delivered?.id).toBe('seaglass');
    expect(came.state.merchant.order).toBeNull();
    expect(came.state.merchant.delivery).toBeNull();
    expect(came.state.storage.map((d) => d.kind)).toEqual(['seaglass']);
  });

  test('a trait item waits until you pick who gets it', () => {
    const r = orderItem(lit(), 'broom');
    if (!('state' in r)) throw new Error(r.why);
    const came = advance(r.state, 600);
    expect(came.delivered).toBeNull();
    expect(waiting(came.state)?.id).toBe('broom');
    expect(nextGoal({ ...came.state, merchant: { ...came.state.merchant, here: false } })).toContain('lighthouse'); // once he's gone
    expect(handOver(came.state, 'nobody')).toBeNull();
    const given = handOver(came.state, 'b')!;
    expect(hasTrait(given, 'b', 'tidy')).toBe(true);
    expect(waiting(given)).toBeNull();
  });

  test('when he leaves, his basket is remembered for the lighthouse, sold out or not', () => {
    const s = lit();
    const came = advance({ ...s, merchant: { ...s.merchant, wait: 1 } }, 1).state;
    const brought = came.merchant.offers!.map((o) => o.id);
    const soldOut = { ...came, merchant: { ...came.merchant, offers: came.merchant.offers!.map((o) => ({ ...o, left: 0 })) } };
    const gone = advance(soldOut, 1).state;
    expect(gone.merchant.here).toBe(false);
    expect(gone.merchant.last).toEqual(brought);
  });
});
