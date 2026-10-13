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
