import { describe, expect, test } from 'vitest';
import { newStudio, normaliseStudio, PRIMARIES, STUDIO_VERSION, studioData } from '../src/studio/state';
import { ADDED_SINCE_STUDIO_V1, GOLDEN_STUDIO as SAVED_V1 } from './recipes';

describe('studio saves', () => {
  test('a new studio starts with one bare ghost on a small, empty island', () => {
    const s = newStudio(0);
    expect(s.characters).toHaveLength(1);
    expect(s.characters[0].layers).toEqual([]);
    expect(s.characters[0].body).toBe('ghost');
    expect(s.island).toEqual({ radius: 5, items: [] });
    expect(s.purse).toEqual({ clay: 0, paint: {} });
  });

  test('a save from the first Studio version still loads exactly as it was', () => {
    const { v: _, ...saved } = SAVED_V1;
    expect(normaliseStudio(JSON.parse(JSON.stringify(SAVED_V1)))).toEqual({ ...saved, ...ADDED_SINCE_STUDIO_V1 });
  });

  test('a mix in the bowl and the colours found survive a reload', () => {
    const s = { ...newStudio(1000), bowl: { a: '#d8382f', b: '#f2c230', left: 3.5 }, discovered: ['#f08a24'] };
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(s))))).toEqual(s);
    expect(normaliseStudio({ ...studioData(s), bowl: { a: 'red', b: 4 }, discovered: ['#F08A24', 'x', '#f08a24'] }, 5)).toMatchObject({ bowl: null, discovered: ['#f08a24'] });
  });

  test('a save goes round trip unchanged', () => {
    const s = newStudio(1000);
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(s))))).toEqual(s);
  });

  test('the merchant and traits survive a reload; rubbish traits are cleaned up', () => {
    const s = newStudio(1000);
    const id = s.characters[0].id;
    const saved = { ...s, merchant: { here: true, wait: 0, stay: 120, paid: 55, visits: 2, offers: [{ id: 'tree', left: 2 }], last: ['rock', 'shell'], order: { id: 'seaglass', clay: 19, paint: { colour: PRIMARIES.cobalt, n: 1 } }, delivery: 'broom' }, traits: { [id]: ['tidy' as const] } };
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(saved))))).toEqual(saved);
    const messy = normaliseStudio({ ...studioData(saved), traits: { [id]: ['tidy', 'tidy', 'flying'], ghost: ['tidy'] }, merchant: { paid: -4 } }, 5);
    expect(messy.traits).toEqual({ [id]: ['tidy'] });
    expect(messy.merchant).toEqual({ here: false, wait: 20, stay: 0, paid: 0, visits: 0, offers: null, last: [], order: null, delivery: null });
  });

  test('a boat at sea and a waiting haul survive a reload; rubbish is cleaned up', () => {
    const s = newStudio(1000);
    const id = s.characters[0].id;
    const saved = {
      ...s,
      harbour: { level: 1, trip: { to: 'reef', crew: [id], left: 600 }, haul: { to: 'shallows', finds: [{ who: id, what: 'clay', amount: 4 }] }, trips: { [id]: 2 } },
    };
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(saved))))).toEqual(saved);
    const messy = normaliseStudio({ ...studioData(saved), harbour: { level: -2, trip: { to: 'reef', crew: [] }, haul: { to: 'x', finds: [7] } } }, 5);
    expect(messy.harbour).toEqual({ level: 0, trip: null, haul: null, trips: {} });
  });

  test('storage survives a reload; harbours, unknown kinds and repeated ids are dropped', () => {
    const s = { ...newStudio(1000), storage: [{ id: 'tree-a', kind: 'tree' as const, size: 1.2, rot: 0.5 }, { id: 'well-b', kind: 'well' as const, size: 1, rot: 0 }] };
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(s))))).toEqual(s);
    const messy = normaliseStudio({
      ...studioData(s),
      island: { radius: 5, items: [{ id: 'rock-c', kind: 'rock', x: 0, z: 0, size: 0.4, rot: 0 }] },
      storage: [...s.storage, { id: 'tree-a', kind: 'tree', size: 1, rot: 0 }, { id: 'rock-c', kind: 'rock', size: 1, rot: 0 }, { id: 'h', kind: 'harbour', size: 1, rot: 0 }, { id: 'x', kind: 'castle' }, 'junk'],
    }, 5);
    expect(messy.storage.map((d) => d.id)).toEqual(['tree-a', 'well-b']);
  });

  test('moods and friendships survive a reload; rubbish is cleaned up', () => {
    const base = newStudio(1000);
    const [a] = base.characters;
    const s = { ...base, characters: [a, { ...a, id: 'zz' }], mood: { [a.id]: { comfort: 0.3, lift: 0.1, petted: 5 } }, friends: { [`${a.id}|zz`]: 0.4 } };
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(s))))).toEqual(s);
    const messy = normaliseStudio({ ...studioData(s), mood: { [a.id]: { comfort: 7, lift: -1 }, ghost: { comfort: 1 } }, friends: { [`zz|${a.id}`]: 0.5, 'x|y': 1, [`${a.id}|zz`]: 3 } }, 5);
    expect(messy.mood).toEqual({ [a.id]: { comfort: 1, lift: 0, petted: 0 } });
    expect(messy.friends).toEqual({ [`${a.id}|zz`]: 1 });
  });

  test('nothing, rubbish or an empty save gives a fresh studio, always with a ghost', () => {
    expect(normaliseStudio(null, 5).characters).toHaveLength(1);
    expect(normaliseStudio('hello', 5).lastSeen).toBe(5);
    expect(normaliseStudio({ characters: [] }, 5).characters).toHaveLength(1);
  });

  test('broken numbers and stray paint names are cleaned up, never negative', () => {
    const s = normaliseStudio({ purse: { clay: -5, paint: { red: 3, '#2F55B5': 2, '#d8382f': -1 } }, ground: [{ id: 'x', what: 'gold', x: 0, z: 0 }] }, 5);
    expect(s.purse).toEqual({ clay: 0, paint: { '#2f55b5': 2 } });
    expect(s.ground).toEqual([]);
  });

  test('a save from a newer version loads what it understands', () => {
    const s = normaliseStudio({ ...SAVED_V1, v: STUDIO_VERSION + 1, pets: ['cat'], island: { radius: 6, items: [{ kind: 'castle', x: 0, z: 0 }] } });
    expect(s.characters).toHaveLength(2);
    expect(s.island.items).toEqual([]);
  });
});
