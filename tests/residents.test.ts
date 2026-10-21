import { describe, expect, test } from 'vitest';
import { cantLeave, rename, sayGoodbye } from '../src/studio/residents';
import { countTags, filterBy, type Resident } from '../src/ui/residents';
import { bareGhost, newStudio, type StudioState } from '../src/studio/state';

/** Three residents with traits, moods, friendships and progress, one of them (c) away at sea. */
function studio(): StudioState {
  const s = newStudio(0);
  return {
    ...s,
    characters: ['a', 'b', 'c'].map((id) => bareGhost({ id, name: id.toUpperCase(), personality: 'calm' })),
    traits: { a: ['tidy'], b: ['tidy', 'seafarer'] },
    mood: { a: { comfort: 0.5, lift: 0.2, petted: 0 }, b: { comfort: 0.1, lift: 0, petted: 0 } },
    friends: { 'a|b': 0.6, 'a|c': 0.3, 'b|c': 0.9 },
    progress: { a: 4, b: 2, c: 1, 'well-1': 9 },
    harbour: { ...s.harbour, trip: { to: 'shallows', crew: ['c'], left: 100 }, trips: { a: 2, c: 1 } },
    ghostsMade: 3,
  };
}

describe('residents in the Studio', () => {
  test('saying goodbye: they leave, and everything kept about them goes too', () => {
    const s = sayGoodbye(studio(), 'a')!;
    expect(s.characters.map((c) => c.id)).toEqual(['b', 'c']);
    expect(s.traits).toEqual({ b: ['tidy', 'seafarer'] });
    expect(Object.keys(s.mood)).toEqual(['b']);
    expect(s.friends).toEqual({ 'b|c': 0.9 });
    expect(s.progress).toEqual({ b: 2, c: 1, 'well-1': 9 }); // the well keeps going
    expect(s.harbour.trips).toEqual({ c: 1 });
    expect(s.ghostsMade).toBe(3); // the next ghost costs the same
  });

  test('not someone at sea, not the last one, not someone who never lived here', () => {
    expect(cantLeave(studio(), 'c')).toBe('sea');
    expect(sayGoodbye(studio(), 'c')).toBeNull();
    const alone = { ...studio(), characters: [bareGhost({ id: 'a' })], harbour: newStudio(0).harbour };
    expect(cantLeave(alone, 'a')).toBe('last');
    expect(sayGoodbye(alone, 'a')).toBeNull();
    expect(cantLeave(studio(), 'zz')).toBe('who');
    expect(cantLeave(studio(), 'b')).toBeNull();
  });

  test('renaming: trimmed, at most 18 letters, never empty', () => {
    const s = rename(studio(), 'a', '  Mochi  ')!;
    expect(s.characters[0].name).toBe('Mochi');
    expect(rename(studio(), 'a', 'A very very long name indeed')!.characters[0].name).toHaveLength(18);
    expect(rename(studio(), 'a', '   ')).toBeNull();
    expect(rename(studio(), 'a', 'A')).toBeNull(); // unchanged
    expect(rename(studio(), 'zz', 'Bo')).toBeNull();
  });
});

describe('the residents list', () => {
  const r = (id: string, tags: string[]): Resident => ({ id, name: id, swatch: '#fff', facts: [], tags, actions: [] });
  const list = [r('a', ['calm', 'tidy']), r('b', ['calm', 'tidy', 'seafarer']), r('c', ['shy'])];
  const tags = [{ key: 'tidy', label: 'Tidy' }, { key: 'seafarer', label: 'Seafarer' }, { key: 'calm', label: 'Calm' }, { key: 'bouncy', label: 'Bouncy' }, { key: 'shy', label: 'Shy' }];

  test('counts each trait and personality, in order, leaving out ones nobody has', () => {
    expect(countTags(list, tags).map((t) => `${t.key} ${t.n}`)).toEqual(['tidy 2', 'seafarer 1', 'calm 2', 'shy 1']);
  });

  test('filters to those with a tag, or shows everyone', () => {
    expect(filterBy(list, 'tidy').map((x) => x.id)).toEqual(['a', 'b']);
    expect(filterBy(list, null)).toHaveLength(3);
  });
});
