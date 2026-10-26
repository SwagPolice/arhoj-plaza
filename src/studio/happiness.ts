/*
 * Happiness, hidden: comfort from the island around a character (decorations nearby, room to wander), plus a
 * lift from chats with friends and a little attention from you, which fades. Happier characters drop a little
 * more, never less than the basic rate. Pure functions, like economy.ts; tests/studio-happiness.test.ts checks them.
 */
import type { DecorKind, IslandLayout } from '../scene/layout';
import type { Mood, StudioState } from './state';

export const BOOST = 0.25; // drops come up to this much faster at full happiness
export const LIFT_HALF = 5 * 60; // seconds for a lift to fade by half
export const COMFORT_EASE = 60; // seconds for comfort to settle most of the way to where a character is
export const PET_EVERY = 10 * 60 * 1000; // ms between taps that count as attention
const NEAR = 2.5; // how far decorations make a character comfortable
const DECOR_MAX = 0.45; // comfort from decorations, at most
const ROOM_MAX = 0.15; // comfort from room to wander, at most
const ROOM_EACH = 10; // square steps of island per character that feel roomy
const CHAT_LIFT = 0.05; // a chat with someone new…
const FRIEND_LIFT = 0.05; // …plus up to this with a close friend
const FRIENDSHIP_STEP = 0.1;
const PET_LIFT = 0.05;

/** Decorations that make the island cosy (not the buildings). */
const COSY: DecorKind[] = ['tree', 'pond', 'rock', 'mushroom', 'shell', 'seaglass', 'driftwood', 'coral', 'figurine'];

const NEUTRAL: Mood = { comfort: 0, lift: 0, petted: 0 };
export const moodOf = (s: StudioState, id: string): Mood => s.mood[id] ?? NEUTRAL;

/** 0 to 1: how happy a character is. */
export const happiness = (s: StudioState, id: string) => Math.min(1, moodOf(s, id).comfort + moodOf(s, id).lift);

/** The hearts a tap shows: 1, 2 or 3. */
export const hearts = (h: number) => (h < 1 / 3 ? 1 : h < 2 / 3 ? 2 : 3);

/**
 * How comfortable it is to be at (x, z): decorations close by, room to wander on the island, and having a home
 * (`home`, the comfort a house gives; 0 without one).
 */
export function comfortHere(island: IslandLayout, pos: { x: number; z: number }, characters: number, home = 0): number {
  let decor = 0;
  for (const d of island.items) {
    if (!COSY.includes(d.kind)) continue;
    const dist = Math.hypot(d.x - pos.x, d.z - pos.z);
    if (dist < NEAR) decor += 0.1 * (1.5 - dist / NEAR); // closer counts more (0.15 right beside it, 0.05 at the edge)
  }
  const area = Math.PI * island.radius ** 2;
  const room = ROOM_MAX * Math.min(1, area / Math.max(1, characters) / ROOM_EACH);
  return Math.min(DECOR_MAX, decor) + room + home;
}

const withMood = (s: StudioState, id: string, change: Partial<Mood>): StudioState => ({
  ...s,
  mood: { ...s.mood, [id]: { ...moodOf(s, id), ...change } },
});

/** Ease a character's comfort towards how comfortable its spot is (so passing one tree doesn't spike it). */
export function settleComfort(s: StudioState, id: string, target: number, dt: number): StudioState {
  const now = moodOf(s, id).comfort;
  const k = 1 - Math.exp(-dt / (COMFORT_EASE / 3));
  return withMood(s, id, { comfort: now + (target - now) * k });
}

const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const friendship = (s: StudioState, a: string, b: string) => s.friends[pair(a, b)] ?? 0;

/** Two characters had a chat: both get a lift (more with a closer friend), and they become a little closer. */
export function chatted(s: StudioState, a: string, b: string): StudioState {
  if (a === b) return s;
  const close = friendship(s, a, b);
  const lift = CHAT_LIFT + FRIEND_LIFT * close;
  let next = withMood(s, a, { lift: Math.min(1, moodOf(s, a).lift + lift) });
  next = withMood(next, b, { lift: Math.min(1, moodOf(next, b).lift + lift) });
  const closer = Math.min(1, Math.round((close + FRIENDSHIP_STEP) * 100) / 100); // rounded, so ten chats make exactly 1
  return { ...next, friends: { ...next.friends, [pair(a, b)]: closer } };
}

/** You tapped a character: a little attention, counted at most once every 10 minutes. */
export function petted(s: StudioState, id: string, now: number): StudioState {
  const m = moodOf(s, id);
  if (now - m.petted < PET_EVERY) return s;
  return withMood(s, id, { lift: Math.min(1, m.lift + PET_LIFT), petted: now });
}

/** Lifts fade by half every five minutes. */
export function fadeLifts(mood: Record<string, Mood>, dt: number): Record<string, Mood> {
  if (dt <= 0) return mood;
  const k = 0.5 ** (dt / LIFT_HALF);
  const out: Record<string, Mood> = {};
  for (const [id, m] of Object.entries(mood)) out[id] = m.lift ? { ...m, lift: m.lift * k < 1e-4 ? 0 : m.lift * k } : m;
  return out;
}

/** The friend a character is closest to, once they're properly close (friendship of at least a half). */
export function bestFriend(s: StudioState, id: string): string | null {
  let best: string | null = null;
  let most = 0.5 - 1e-9;
  for (const [key, v] of Object.entries(s.friends)) {
    const [a, b] = key.split('|');
    if ((a === id || b === id) && v > most) [best, most] = [a === id ? b : a, v];
  }
  return best;
}
