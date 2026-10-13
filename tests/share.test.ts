import { describe, expect, test } from 'vitest';
import { decodeCharacter, encodeCharacter, ShareError } from '../src/share';
import { normaliseRecipe, randomRecipe, RECIPE_VERSION, type CharacterRecipe } from '../src/character/recipe';
import { GOLDEN } from './fixtures';

const withoutId = ({ id: _, ...rest }: CharacterRecipe) => rest;

describe('old share codes keep working', () => {
  for (const g of GOLDEN) {
    test(`${g.expected.name} (${g.made})`, async () => {
      const { recipe, fromNewer } = await decodeCharacter(g.code);
      expect(withoutId(recipe)).toEqual(g.expected);
      expect(fromNewer).toBe(false);
    });
  }
});

describe('sharing', () => {
  test('any character survives a round trip unchanged (except its id)', async () => {
    for (let i = 0; i < 50; i++) {
      const r = randomRecipe();
      const { recipe } = await decodeCharacter(await encodeCharacter(r));
      expect(withoutId(recipe)).toEqual(withoutId(r));
      expect(recipe.id).not.toBe(r.id);
    }
  });

  test('a whole share link works as well as the bare code', async () => {
    const code = GOLDEN[0].code;
    const { recipe } = await decodeCharacter(`https://example.github.io/arhoj-plaza/#import=${code}\n`);
    expect(recipe.name).toBe(GOLDEN[0].expected.name);
  });

  test('codes that are not codes, or are cut short, give a friendly error', async () => {
    await expect(decodeCharacter('hello')).rejects.toBeInstanceOf(ShareError);
    await expect(decodeCharacter(GOLDEN[0].code.slice(0, 40))).rejects.toBeInstanceOf(ShareError);
  });
});

describe('loading older or newer data', () => {
  test('a character saved by the very first version (before versions existed) still loads', () => {
    const r = normaliseRecipe({
      id: 'abc', name: 'Pip', body: 'cone', height: 1, width: 1,
      glaze: '#efe5d0', glazeFinish: 'drip', topper: 'cap', topperColour: '#ec8a6a',
      eyes: 'closed', mouth: 'smile', cheeks: true, personality: 'calm',
    });
    expect(r.name).toBe('Pip');
    expect(r.body).toBe('cone');
    expect(r.layers).toEqual([expect.objectContaining({ colour: '#efe5d0', edge: 'drips' })]);
    expect(r.eyes).toBe('happy'); // old closed eyes
    expect(r.mouth).toBe('none'); // cartoon mouths were removed
    expect(r).not.toHaveProperty('cheeks');
    expect(r).not.toHaveProperty('topper');
  });

  test('a code from a newer version opens as closely as possible and says so', async () => {
    const future = { v: RECIPE_VERSION + 1, name: 'Zap', body: 'teapot', eyes: 'laser', personality: 'bouncy', sparkle: 9 };
    const bytes = new TextEncoder().encode(JSON.stringify(future));
    const deflated = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const code = 'arhoj1.' + btoa(String.fromCharCode(...deflated)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const { recipe, fromNewer } = await decodeCharacter(code);
    expect(fromNewer).toBe(true);
    expect(recipe.name).toBe('Zap');
    expect(recipe.personality).toBe('bouncy');
    expect(recipe.body).toBe('ghost'); // unknown shape falls back to the default
    expect(recipe.eyes).toBe('open');
  });
});
