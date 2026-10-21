import { describe, expect, test } from 'vitest';
import { foundCount, noteFound, PAGES, REWARDS, source } from '../src/studio/book';
import { mixResult, RECIPES, WHITE } from '../src/studio/mixing';
import { GLAZES } from '../src/character/palette';
import { newStudio, PRIMARIES, type StudioState } from '../src/studio/state';

const hex = (name: string) => GLAZES.find((g) => g.name === name)!.hex;
const owning = (...colours: string[]): StudioState => ({ ...newStudio(0), purse: { clay: 0, paint: Object.fromEntries(colours.map((c) => [c, 1])) } });

describe('the palette book', () => {
  test('18 glaze colours and 4 lustres', () => {
    expect(PAGES.filter((p) => !p.lustre)).toHaveLength(18);
    expect(PAGES.filter((p) => p.lustre)).toHaveLength(4);
  });

  test('the last three recipes: cream, coral and black', () => {
    expect(mixResult(PRIMARIES.yellow, WHITE)).toBe(hex('Cream'));
    expect(mixResult(hex('Orange'), WHITE)).toBe(hex('Coral'));
    expect(mixResult(hex('Plum'), hex('Green'))).toBe(hex('Black'));
  });

  test('every glaze colour can be found: from the wells, the stars, or a recipe', () => {
    const have = new Set<string>([...Object.values(PRIMARIES), WHITE]);
    for (let round = 0; round < 4; round++) for (const [a, b, c] of RECIPES) if (have.has(a) && have.has(b)) have.add(c);
    for (const g of GLAZES) expect(have).toContain(g.hex);
    for (const p of PAGES.filter((p) => !p.lustre)) expect(source(p)).not.toBe('');
  });

  test('colours owned, made or glazed with count as found, once each', () => {
    const s = { ...owning(PRIMARIES.red, PRIMARIES.red), discovered: [hex('Orange')] };
    const r = noteFound(s);
    expect(r.state.book.found).toEqual(expect.arrayContaining([PRIMARIES.red, hex('Orange')]));
    expect(foundCount(r.state)).toBe(2);
    expect(noteFound(r.state).state).toBe(r.state); // nothing new: same state
    // Found stays found after the paint is spent.
    expect(foundCount(noteFound({ ...r.state, purse: { clay: 0, paint: {} } }).state)).toBe(2);
  });

  test('every 6 colours brings a decoration into storage, once', () => {
    const six = GLAZES.slice(0, 6).map((g) => g.hex);
    const r = noteFound(owning(...six));
    expect(r.rewards.map((x) => x.kind)).toEqual([REWARDS[0].kind]);
    expect(r.state.storage.map((d) => d.kind)).toEqual(['vase']);
    expect(noteFound(r.state).rewards).toEqual([]);
    const all = noteFound(owning(...GLAZES.map((g) => g.hex)));
    expect(all.rewards.map((x) => x.at)).toEqual([6, 12, 18]); // the rainbow needs the lustres too
  });
});
