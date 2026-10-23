/*
 * One-room houses: each is home to one resident, who's happier for it and now and then goes in for a while.
 * There's no limit on how many ghosts can live on the island: a house is a reward, not a cap.
 * Pure functions, like economy.ts; tests/studio-houses.test.ts checks them.
 */
import { placeNew, type Decor } from '../scene/layout';
import type { StudioState } from './state';

export const HOUSE_COST = 120; // the first; each one after costs more
export const HOME_COMFORT = 0.2; // how much more comfortable someone is with a home on the island
export const INDOORS = { min: 20, max: 45 }; // seconds someone spends inside on a visit home
export const VISIT_EVERY = 150; // seconds, on average, between visits home

/** Every house you own, on the island or put away. */
const housesOwned = (s: StudioState) => [...s.island.items, ...s.storage].filter((d) => d.kind === 'house').length;

/** 120 clay for the first, then half as much again for each one after (120, 180, 270…). */
export const houseCost = (s: StudioState) => Math.round(HOUSE_COST * 1.5 ** housesOwned(s));
/** Houses come once there's a glaze well: something to make the island homely while it grows. */
export const housesUnlocked = (s: StudioState) => s.wellsBuilt > 0;

/** Build a house: it goes on the island at the free spot nearest the middle. Null if you can't afford it or it's full. */
export function buyHouse(s: StudioState): { state: StudioState; house: Decor } | null {
  const cost = houseCost(s);
  if (!housesUnlocked(s) || s.purse.clay < cost) return null;
  const house = placeNew(s.island, 'house');
  if (!house) return null;
  return {
    state: { ...s, purse: { ...s.purse, clay: s.purse.clay - cost }, island: { ...s.island, items: [...s.island.items, house] } },
    house,
  };
}

/** Who lives in a house, if anyone. */
export const residentOf = (s: StudioState, houseId: string) => s.homes[houseId] ?? null;

/** Someone's house, if they have one and it's out on the island (a house put away isn't a home just now). */
export function homeOf(s: StudioState, characterId: string): Decor | null {
  const id = Object.keys(s.homes).find((h) => s.homes[h] === characterId);
  return (id && s.island.items.find((d) => d.id === id)) || null;
}

/** Someone moves into a house: out of any other house they had, and whoever lived here before moves out. */
export function moveIn(s: StudioState, houseId: string, characterId: string): StudioState | null {
  const house = [...s.island.items, ...s.storage].find((d) => d.id === houseId && d.kind === 'house');
  if (!house || !s.characters.some((c) => c.id === characterId) || s.homes[houseId] === characterId) return null;
  const homes = Object.fromEntries(Object.entries(s.homes).filter(([, who]) => who !== characterId));
  return { ...s, homes: { ...homes, [houseId]: characterId } };
}

/** The house is empty again. */
export function moveOut(s: StudioState, houseId: string): StudioState | null {
  if (!s.homes[houseId]) return null;
  const { [houseId]: _, ...homes } = s.homes;
  return { ...s, homes };
}
