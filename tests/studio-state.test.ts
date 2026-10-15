import { describe, expect, test } from 'vitest';
import { newStudio, normaliseStudio, STUDIO_VERSION, studioData } from '../src/studio/state';
import { GOLDEN_STUDIO as SAVED_V1 } from './recipes';

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
    // Fields added since then start empty: no mix stirring, no colours mixed yet.
    expect(normaliseStudio(JSON.parse(JSON.stringify(SAVED_V1)))).toEqual({ ...saved, bowl: null, discovered: [] });
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
