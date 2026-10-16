import { describe, expect, test } from 'vitest';
import { advance, BOWL_COST, buyBowl, buyWell, ownsBowl, startMix } from '../src/studio/economy';
import { canStore, putAway, store, stored, takeOut } from '../src/studio/storage';
import { FIRST_VISIT, newStudio, PRIMARIES, type StudioState } from '../src/studio/state';

const start = (): StudioState => ({ ...newStudio(0), seed: 4, purse: { clay: 1000, paint: { [PRIMARIES.red]: 1, [PRIMARIES.yellow]: 1 } } });

describe('storage', () => {
  test('things go in and come out by kind, keeping their id, size and turn', () => {
    let s = store(store(start(), 'tree'), 'shell');
    expect(stored(s)).toEqual([{ kind: 'tree', count: 1 }, { kind: 'shell', count: 1 }]);
    const out = takeOut(s, 'shell')!;
    expect(out.state.storage.map((d) => d.kind)).toEqual(['tree']);
    const shell = { ...out.item, size: 1.3, rot: 2 };
    s = { ...out.state, island: { ...out.state.island, items: out.state.island.items.map((d) => (d.id === shell.id ? shell : d)) } };
    const away = putAway(s, shell.id)!;
    expect(away.island.items.some((d) => d.id === shell.id)).toBe(false);
    expect(away.storage.at(-1)).toEqual({ id: shell.id, kind: 'shell', size: 1.3, rot: 2 });
    const back = takeOut(away, 'shell')!;
    expect(back.item).toMatchObject({ id: shell.id, size: 1.3, rot: 2 });
    expect(takeOut(back.state, 'shell')).toBeNull(); // none left
  });

  test('no limit, but taking out needs room on the island', () => {
    let s = start();
    for (let i = 0; i < 60; i++) s = store(s, 'rock');
    expect(stored(s)).toEqual([{ kind: 'rock', count: 60 }]);
    const full = { ...s, island: { ...s.island, items: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, kind: 'mushroom' as const, x: 0, z: 0, size: 1, rot: 0 })) } };
    expect(takeOut(full, 'rock')).toBeNull();
  });

  test('the harbour stays on its edge, and the bowl waits for its mix to finish', () => {
    expect(canStore('harbour')).toBe(false);
    const withBowl = buyBowl({ ...start(), purse: { clay: BOWL_COST, paint: { [PRIMARIES.red]: 1, [PRIMARIES.yellow]: 1 } } })!;
    const bowl = withBowl.island.items.find((d) => d.kind === 'bowl')!;
    const stirring = startMix(withBowl, PRIMARIES.red, PRIMARIES.yellow)!;
    expect(putAway(stirring, bowl.id)).toBeNull();
    expect(putAway(withBowl, bowl.id)).not.toBeNull();
  });

  test('a stored well makes no paint, and keeps its water colour', () => {
    const s = advance(buyWell(start())!, 600).state;
    const well = s.island.items.find((d) => d.kind === 'well')!;
    const tint = s.wellTints[well.id];
    const away = putAway(s, well.id)!;
    expect(advance(away, 3600).yields.some((y) => y.from === well.id)).toBe(false);
    expect(away.wellTints[well.id]).toBe(tint);
  });

  test('a stored bowl is still yours: no second bowl, and the merchant still comes', () => {
    const withBowl = { ...buyBowl({ ...start(), purse: { clay: BOWL_COST, paint: {} } })!, purse: { clay: 1000, paint: {} } };
    const away = putAway(withBowl, withBowl.island.items.find((d) => d.kind === 'bowl')!.id)!;
    expect(ownsBowl(away)).toBe(true);
    expect(buyBowl(away)).toBeNull();
    expect(advance(away, FIRST_VISIT).visit).toBe('arrived');
  });
});
