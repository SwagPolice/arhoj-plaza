/*
 * Shooting stars: now and then a star falls and scatters a few shards of white paint on the island. The first
 * comes about 20 minutes after the mixing bowl (white only matters once you can mix); after that, none for at
 * least 3 hours, most within about 6, and always one within 8 (a pity timer). Real time, away too.
 * Pure functions, like economy.ts; tests/studio-stars.test.ts checks them.
 */
import { WHITE } from './mixing';

export const FIRST_STAR = 20 * 60; // seconds after the mixing bowl
export const STAR_GAP = { min: 3 * 3600, likely: 6 * 3600, max: 8 * 3600 };
export const SHARDS = { min: 3, max: 5 }; // white paint per star
export { WHITE };

/** Seconds until the next star (counted once there's a bowl), and how many have fallen so far. */
export type Stars = { wait: number; seen: number };
export const newStars = (): Stars => ({ wait: FIRST_STAR, seen: 0 });

/**
 * The wait after a star: at least 3 hours, then more and more likely each minute (most by about 6 hours),
 * and never more than 8. Drawn once per star, so long times away work out the same as playing.
 */
export function nextGap(rand: () => number): number {
  const beyond = STAR_GAP.likely - STAR_GAP.min; // by then, 85% of stars have fallen
  const k = (2 * -Math.log(0.15)) / beyond ** 2; // a chance that grows steadily with time
  const t = Math.sqrt((-2 * Math.log(1 - rand())) / k);
  return STAR_GAP.min + Math.min(t, STAR_GAP.max - STAR_GAP.min);
}

/** Time passes for the stars: how many shards fell (0 if no star), and the stars' new state. */
export function stepStars(stars: Stars, hasBowl: boolean, dt: number, rand: () => number): { stars: Stars; shards: number[] } {
  if (!hasBowl) return { stars, shards: [] };
  let now = stars;
  let left = dt;
  const shards: number[] = []; // one entry per star that fell: how many shards it brought
  while (now.wait <= left) {
    left -= now.wait;
    shards.push(SHARDS.min + Math.floor(rand() * (SHARDS.max - SHARDS.min + 1)));
    now = { wait: nextGap(rand), seen: now.seen + 1 };
  }
  return { stars: { ...now, wait: now.wait - left }, shards };
}
