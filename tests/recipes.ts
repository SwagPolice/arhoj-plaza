import type { CharacterRecipe } from '../src/character/recipe';

// Characters frozen at the time each golden share code was made (ids are never shared).
export type Golden = Omit<CharacterRecipe, 'id'>;

export const NISSE: Golden = {
  name: 'Nisse',
  seed: 12345,
  body: 'ghost',
  height: 1.2,
  width: 0.9,
  clayHeight: 0.22,
  layers: [
    { colour: '#f7f4ee', finish: 'glossy', pattern: 'plain', patternColour: '#fffdf8', edge: 'clean', reach: 0.5 },
    { colour: '#d8382f', finish: 'glossy', pattern: 'dots', patternColour: '#f7f4ee', edge: 'clean', reach: 0.62 },
  ],
  glass: { core: '#f2b8ae', coreFinish: 'solid', cap: '#f08a24', capPattern: 'dots', capPatternColour: '#2f55b5' },
  eyes: 'open',
  eyeHeight: 0.35,
  eyeSize: 1.2,
  eyeSpacing: 0.1,
  mouth: 'none',
  personality: 'calm',
};

export const DRIPPY: Golden = {
  name: 'Drippy 2',
  seed: 987654,
  body: 'bell',
  height: 1.05,
  width: 1.1,
  clayHeight: 0.15,
  layers: [
    { colour: '#c9b6e4', finish: 'satin', pattern: 'speckle', patternColour: '#24232a', edge: 'wavy', reach: 0.5 },
    { colour: '#2f55b5', finish: 'glossy', pattern: 'streaks', patternColour: '#24232a', edge: 'drips', reach: 0.4 },
    { colour: '#e0ad4a', finish: 'metallic', pattern: 'plain', patternColour: '#fffdf8', edge: 'fade', reach: 0.15 },
  ],
  glass: { core: '#a9e0c8', coreFinish: 'frosted', cap: '#7a4a7c', capPattern: 'glitter', capPatternColour: '#f2b8ae' },
  eyes: 'tired',
  eyeHeight: 0.8,
  eyeSize: 0.9,
  eyeSpacing: 0.6,
  mouth: 'red',
  personality: 'shy',
};

export const SHROOM: Golden = {
  name: 'Svampe',
  seed: 42,
  body: 'mushroom',
  height: 1.3,
  width: 0.85,
  clayHeight: 0.2,
  layers: [{ colour: '#a9e0c8', finish: 'glossy', pattern: 'plain', patternColour: '#fffdf8', edge: 'clean', reach: 0.5 }],
  glass: { core: '#c9b6e4', coreFinish: 'frosted', cap: '#f2b8ae', capPattern: 'confetti', capPatternColour: '#1f8a55' },
  eyes: 'crossed',
  eyeHeight: 0.5,
  eyeSize: 1,
  eyeSpacing: 0,
  mouth: 'none',
  personality: 'bouncy',
};

// An island frozen when island codes were introduced (2026-10-14): one of everything, a turned rock.
export const GOLDEN_ISLAND = {
  radius: 8.6,
  items: [
    { id: 'a', kind: 'pond' as const, x: -2.5, z: 1.8, size: 1.6, rot: 0 },
    { id: 'b', kind: 'tree' as const, x: 4.1, z: -2.2, size: 1.42, rot: 0 },
    { id: 'c', kind: 'tree' as const, x: -4.8, z: -3.9, size: 0.75, rot: 0 },
    { id: 'd', kind: 'rock' as const, x: 1.3, z: 4.6, size: 0.66, rot: 1.05 },
    { id: 'e', kind: 'mushroom' as const, x: 0.4, z: -1.1, size: 1.3, rot: 0 },
  ],
};

// A backup frozen when backups were introduced (2026-10-14): two characters (with their ids) and an island.
export const GOLDEN_BACKUP = {
  characters: [
    { ...NISSE, id: 'nisse-1' },
    { ...SHROOM, id: 'shroom-1' },
  ],
  island: GOLDEN_ISLAND,
  made: '2026-10-14T12:00:00.000Z',
};

// A Studio save frozen when Studio Mode began (2026-10-14, studio v1): one bare ghost, one dipped,
// a well, things on the ground, some held back and an uncollected "away" card. Never edit it.
export const GOLDEN_STUDIO = {
  v: 1,
  characters: [
    { ...NISSE, id: 'bare-1', name: 'Pip', layers: [] },
    { ...NISSE, id: 'dipped-1', name: 'Mochi', layers: [{ colour: '#d8382f', finish: 'glossy', pattern: 'plain', patternColour: '#fffdf8', edge: 'clean', reach: 0.5 }] },
  ],
  island: { radius: 5, items: [{ id: 'well-abc', kind: 'well', x: 0.35, z: 0, size: 1, rot: 0 }] },
  purse: { clay: 7, paint: { '#d8382f': 1 } },
  ghostsMade: 2,
  wellsBuilt: 1,
  progress: { 'bare-1': 4.5, 'well-abc': 12 },
  ground: [{ id: 'd1', x: 1, z: -1, what: 'clay', amount: 2 }, { id: 'd2', x: 0.5, z: 1, what: '#2f55b5', amount: 1 }],
  held: { clay: 3, paint: {} },
  away: { clay: 40, paint: { '#f2c230': 2 }, seconds: 3600 },
  wellTints: { 'well-abc': '#2f55b5' },
  firsts: ['well', 'paint'],
  lastSeen: 1_792_000_000_000,
  seed: 12345,
};

/** What a Studio save from before these fields existed loads them as: nothing stirring, nothing found, the merchant not met yet. */
export const ADDED_SINCE_STUDIO_V1 = {
  bowl: null,
  discovered: [],
  merchant: { here: false, wait: 20, stay: 0, paid: 0, visits: 0, offers: null },
  traits: {},
  harbour: { level: 0, trip: null, haul: null, trips: {} },
};

// An island frozen when shells and sea glass arrived (2026-10-15, layout v1): both, turned, beside older kinds.
export const GOLDEN_ISLAND_SHORE = {
  radius: 6.5,
  items: [
    { id: 'a', kind: 'shell' as const, x: 1.2, z: 2.1, size: 1.2, rot: 0.8 },
    { id: 'b', kind: 'seaglass' as const, x: -0.9, z: 2.4, size: 0.9, rot: 2.1 },
    { id: 'c', kind: 'tree' as const, x: -3, z: -2, size: 1.1, rot: 0 },
    { id: 'd', kind: 'mushroom' as const, x: 0.3, z: -0.8, size: 1, rot: 0 },
  ],
};

// An island frozen when driftwood and coral arrived (2026-10-15, layout v1): both, turned, beside a shell.
export const GOLDEN_ISLAND_DRIFT = {
  radius: 6,
  items: [
    { id: 'a', kind: 'driftwood' as const, x: 1.5, z: 1.9, size: 1.1, rot: 0.6 },
    { id: 'b', kind: 'coral' as const, x: -1.2, z: 2.2, size: 1.3, rot: 1.9 },
    { id: 'c', kind: 'shell' as const, x: 0.2, z: -1, size: 1, rot: 0 },
  ],
};
