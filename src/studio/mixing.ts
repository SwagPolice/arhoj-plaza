/*
 * Mixing recipes: two paints in the bowl make a new colour. Recipes never change, so a mix found once
 * always works the same way (the palette book will rely on that). Colours are the existing glazes.
 */
import { GLAZES } from '../character/palette';

const hex = (name: string) => GLAZES.find((g) => g.name === name)!.hex;

/** [one paint, the other, what they make]. The order of the two doesn't matter. */
export const RECIPES: [string, string, string][] = (
  [
    ['Red', 'Yellow', 'Orange'],
    ['Yellow', 'Cobalt', 'Green'],
    ['Red', 'Cobalt', 'Plum'],
    ['Green', 'Yellow', 'Lime'],
    ['Green', 'Cobalt', 'Teal'],
    ['Orange', 'Cobalt', 'Rust'],
    ['Orange', 'Green', 'Moss'],
    // White comes later (shooting stars); these wait for it.
    ['Red', 'White', 'Blush'],
    ['Cobalt', 'White', 'Sky'],
    ['Green', 'White', 'Mint'],
    ['Plum', 'White', 'Lilac'],
  ] as const
).map(([a, b, c]) => [hex(a), hex(b), hex(c)]);

export const WHITE = hex('White');

/** What two paints make together, or null if nothing new. */
export function mixResult(a: string, b: string): string | null {
  const r = RECIPES.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
  return r ? r[2] : null;
}

/** The colours that can be mixed today (not needing white). */
export const MIXABLE = RECIPES.filter(([a, b]) => a !== WHITE && b !== WHITE).map((r) => r[2]);

/** The recipe that makes a colour, if any. */
export const recipeFor = (colour: string) => RECIPES.find((r) => r[2] === colour) ?? null;

/** A glaze's name in lower case ("orange"), for sentences. */
export const colourName = (colour: string) => GLAZES.find((g) => g.hex === colour)?.name.toLowerCase() ?? 'paint';
