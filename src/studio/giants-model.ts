import * as THREE from 'three';
import { buildCharacter } from '../character/build';
import { defaultGlass, defaultLayer, defaultRecipe } from '../character/recipe';
import { serpentShape } from '../scene/island';
import { glaze } from '../scene/stage';
import type { GiantKind } from './giants';

/**
 * How each giant looks: all in one place, so their glazes (and textures, once there are references for them) can
 * change without touching how they move.
 */
export const GIANT_LOOKS = {
  ghost: { glaze: '#f7f4ee' },
  serpent: { glaze: '#3f8f7f' },
  mushroom: { core: '#f2b8ae', cap: '#e8a33d', capPatternColour: '#f7f4ee' },
};

/** How big each is, compared with a character, and how tall that makes it. */
export const GIANT_SCALE: Record<GiantKind, number> = { ghost: 6, serpent: 2.4, mushroom: 5 };

/** A giant of the sea, built around its waterline at y = 0. `height` is how tall it is out of the water at most. */
export function buildGiant(kind: GiantKind): { root: THREE.Group; height: number } {
  const root = new THREE.Group();
  if (kind === 'serpent') {
    const body = serpentShape(glaze(GIANT_LOOKS.serpent.glaze));
    root.add(body);
    root.scale.setScalar(GIANT_SCALE.serpent);
    return { root, height: 0.9 * GIANT_SCALE.serpent };
  }
  const recipe =
    kind === 'ghost'
      ? { ...defaultRecipe(), body: 'ghost' as const, layers: [defaultLayer(GIANT_LOOKS.ghost.glaze)], clayHeight: 0.04, eyes: 'open' as const, eyeSize: 1.2, eyeHeight: 0.95 } // eyes high, to peer over the water
      : {
          ...defaultRecipe(),
          body: 'mushroom' as const,
          glass: { ...defaultGlass(), core: GIANT_LOOKS.mushroom.core, cap: GIANT_LOOKS.mushroom.cap, capPattern: 'dots' as const, capPatternColour: GIANT_LOOKS.mushroom.capPatternColour },
          eyes: 'happy' as const,
        };
  const built = buildCharacter(recipe);
  root.add(built.root);
  root.scale.setScalar(GIANT_SCALE[kind]);
  return { root, height: built.height * GIANT_SCALE[kind] };
}
