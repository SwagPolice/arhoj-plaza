import { describe, expect, test } from 'vitest';
import { decodeCharacter, decodeIsland, encodeCharacter, encodeIsland, ShareError } from '../src/share';
import { defaultLayout, LAYOUT_VERSION, placeNew, type DecorKind, type IslandLayout } from '../src/scene/layout';
import { randomRecipe } from '../src/character/recipe';
import { GOLDEN, GOLDEN_ISLANDS } from './fixtures';

// Ids aren't part of a shared island (the importer makes new ones), so compare without them.
const withoutIds = (l: IslandLayout) => ({ ...l, items: l.items.map(({ id: _, ...rest }) => rest) });

describe('old island codes keep working', () => {
  for (const g of GOLDEN_ISLANDS) {
    test(`island (${g.made})`, async () => {
      const { layout, fromNewer } = await decodeIsland(g.code);
      expect(withoutIds(layout)).toEqual(withoutIds(g.expected));
      expect(fromNewer).toBe(false);
    });
  }
});

describe('sharing islands', () => {
  test('the default island survives a round trip', async () => {
    const { layout } = await decodeIsland(await encodeIsland(defaultLayout()));
    expect(withoutIds(layout)).toEqual(withoutIds(defaultLayout()));
  });

  test('a busy island survives a round trip, with a short enough code', async () => {
    let layout: IslandLayout = { radius: 11, items: [] };
    const kinds: DecorKind[] = ['tree', 'pond', 'rock', 'mushroom'];
    for (let i = 0; i < 40; i++) {
      const item = placeNew(layout, kinds[i % 4]);
      if (item) layout = { ...layout, items: [...layout.items, { ...item, rot: Math.round((i % 12) * 52) / 100 }] };
    }
    const code = await encodeIsland(layout);
    const { layout: back } = await decodeIsland(code);
    expect(withoutIds(back)).toEqual(withoutIds(layout));
    expect(new Set(back.items.map((i) => i.id)).size).toBe(back.items.length); // fresh, unique ids
    expect(code.length).toBeLessThan(2000);
  });

  test('a whole island link works as well as the bare code', async () => {
    const { layout } = await decodeIsland(`https://example.github.io/arhoj-plaza/#island=${GOLDEN_ISLANDS[0].code}`);
    expect(layout.radius).toBe(GOLDEN_ISLANDS[0].expected.radius);
  });

  test('mixing up character and island codes says where each one goes', async () => {
    await expect(decodeIsland(GOLDEN[0].code)).rejects.toThrow(/character code/);
    await expect(decodeCharacter(GOLDEN_ISLANDS[0].code)).rejects.toThrow(/island code/);
    await expect(decodeIsland(await encodeCharacter(randomRecipe()))).rejects.toBeInstanceOf(ShareError);
  });

  test('bad or cut-short codes give a friendly error', async () => {
    await expect(decodeIsland('hello')).rejects.toBeInstanceOf(ShareError);
    await expect(decodeIsland(GOLDEN_ISLANDS[0].code.slice(0, 30))).rejects.toBeInstanceOf(ShareError);
  });

  test('an island from a newer version opens as closely as possible and says so', async () => {
    const future = { v: LAYOUT_VERSION + 1, radius: 8, items: [{ kind: 'castle', x: 0, z: 0 }, { kind: 'rock', x: 2, z: 2, size: 0.5, rot: 1 }] };
    const bytes = new TextEncoder().encode(JSON.stringify(future));
    const deflated = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const code = 'arhojisle1.' + btoa(String.fromCharCode(...deflated)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const { layout, fromNewer } = await decodeIsland(code);
    expect(fromNewer).toBe(true);
    expect(layout.items.map((i) => i.kind)).toEqual(['rock']); // the unknown castle is left out
  });
});
