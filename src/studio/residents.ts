/*
 * Looking after who lives in the Studio: renaming, and saying goodbye. Pure functions, like economy.ts;
 * tests/residents.test.ts checks them.
 */
import { atSea } from './harbour';
import type { StudioState } from './state';

export const NAME_MAX = 18; // as in the character maker

/** A new name (trimmed, at most 18 letters), or null if it's empty or unchanged. */
export function rename(s: StudioState, id: string, name: string): StudioState | null {
  const clean = name.trim().slice(0, NAME_MAX);
  const who = s.characters.find((c) => c.id === id);
  if (!who || !clean || clean === who.name) return null;
  return { ...s, characters: s.characters.map((c) => (c === who ? { ...c, name: clean } : c)) };
}

/** Why someone can't say goodbye right now, or null if they can. */
export function cantLeave(s: StudioState, id: string): 'last' | 'sea' | 'who' | null {
  if (!s.characters.some((c) => c.id === id)) return 'who';
  if (s.characters.length < 2) return 'last';
  if (atSea(s).has(id)) return 'sea';
  return null;
}

/**
 * They leave the studio for good, and everything kept about them goes too: traits, mood, friendships, progress
 * towards their next drop, and their trips. It doesn't make the next ghost any cheaper.
 */
export function sayGoodbye(s: StudioState, id: string): StudioState | null {
  if (cantLeave(s, id)) return null;
  const { [id]: _t, ...traits } = s.traits;
  const { [id]: _m, ...mood } = s.mood;
  const { [id]: _p, ...progress } = s.progress;
  const { [id]: _r, ...trips } = s.harbour.trips;
  const friends = Object.fromEntries(Object.entries(s.friends).filter(([pair]) => !pair.split('|').includes(id)));
  return {
    ...s,
    characters: s.characters.filter((c) => c.id !== id),
    traits, mood, progress, friends,
    harbour: { ...s.harbour, trips },
  };
}
