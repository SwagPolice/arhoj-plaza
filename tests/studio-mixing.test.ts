import { describe, expect, test } from 'vitest';
import { GLAZES } from '../src/character/palette';
import { colourName, MIXABLE, mixResult, RECIPES } from '../src/studio/mixing';
import { PRIMARIES } from '../src/studio/state';

const hex = (name: string) => GLAZES.find((g) => g.name === name)!.hex;

describe('mixing recipes', () => {
  test('every recipe uses and makes real glaze colours, each made one way only', () => {
    const glazes = GLAZES.map((g) => g.hex);
    for (const r of RECIPES) for (const c of r) expect(glazes).toContain(c);
    const made = RECIPES.map((r) => r[2]);
    expect(new Set(made).size).toBe(made.length);
  });

  test('the order of the two paints does not matter', () => {
    expect(mixResult(PRIMARIES.red, PRIMARIES.yellow)).toBe(hex('Orange'));
    expect(mixResult(PRIMARIES.yellow, PRIMARIES.red)).toBe(hex('Orange'));
    expect(mixResult(hex('Green'), PRIMARIES.cobalt)).toBe(hex('Teal'));
  });

  test('a colour with itself, or a pair with no recipe, makes nothing new', () => {
    expect(mixResult(PRIMARIES.red, PRIMARIES.red)).toBeNull();
    expect(mixResult(hex('Plum'), hex('Lime'))).toBeNull();
  });

  test('everything mixable today can be reached from the three primaries', () => {
    const have = new Set<string>(Object.values(PRIMARIES));
    for (let round = 0; round < 3; round++)
      for (const [a, b, c] of RECIPES) if (have.has(a) && have.has(b)) have.add(c);
    for (const c of MIXABLE) expect(have).toContain(c);
    expect(MIXABLE).toHaveLength(8); // black (plum + green) needs no white
  });

  test('colours have names', () => {
    expect(colourName(PRIMARIES.cobalt)).toBe('cobalt');
    expect(colourName('#123456')).toBe('paint');
  });
});
