import { describe, expect, test } from 'vitest';
import { backupCode, backupData, backupFileText, BACKUP_VERSION, newCharacters, readBackup } from '../src/backup';
import { decodeCharacter, decodeIsland, ShareError } from '../src/share';
import { randomRecipe } from '../src/character/recipe';
import { defaultLayout, type IslandLayout } from '../src/scene/layout';
import { GOLDEN, GOLDEN_BACKUPS, GOLDEN_ISLANDS } from './fixtures';

const withoutIds = (l: IslandLayout) => ({ ...l, items: l.items.map(({ id: _, ...rest }) => rest) });

describe('old backups keep working', () => {
  for (const g of GOLDEN_BACKUPS) {
    test(`backup (${g.made})`, async () => {
      const { backup, fromNewer } = await readBackup(g.code);
      expect(backup.characters).toEqual(g.expected.characters); // ids included: they matter for "Add to mine"
      expect(withoutIds(backup.island)).toEqual(withoutIds(g.expected.island));
      expect(backup.made).toBe(g.expected.made);
      expect(fromNewer).toBe(false);
    });
  }
});

describe('backups', () => {
  const characters = Array.from({ length: 30 }, () => randomRecipe());
  const island = defaultLayout();

  test('a backup code brings back every character and the island exactly', async () => {
    const { backup } = await readBackup(await backupCode(characters, island));
    expect(backup.characters).toEqual(characters);
    expect(backup.island).toEqual(island);
  });

  test('so does a backup file', async () => {
    const { backup } = await readBackup(backupFileText(characters, island));
    expect(backup.characters).toEqual(characters);
    expect(backup.island).toEqual(island);
  });

  test('"Add to mine" only adds characters that are not already here', () => {
    const mine = characters.slice(0, 10);
    const added = newCharacters(mine, characters);
    expect(added).toHaveLength(20);
    expect(added.every((r) => !mine.some((m) => m.id === r.id))).toBe(true);
  });

  test('other files and codes are turned away with a helpful message', async () => {
    await expect(readBackup('{"hello": 1}')).rejects.toThrow(/isn't an Arhoj Plaza backup/);
    await expect(readBackup('{oops')).rejects.toBeInstanceOf(ShareError);
    await expect(readBackup(GOLDEN[0].code)).rejects.toThrow(/character code/);
    await expect(readBackup(GOLDEN_ISLANDS[0].code)).rejects.toThrow(/island code/);
    await expect(readBackup('hello')).rejects.toBeInstanceOf(ShareError);
  });

  test('backup codes pasted into the character or island import point to Backup', async () => {
    const code = GOLDEN_BACKUPS[0].code;
    await expect(decodeCharacter(code)).rejects.toThrow(/backup code/);
    await expect(decodeIsland(code)).rejects.toThrow(/backup code/);
  });

  test('a backup from a newer version loads what it can and says so', async () => {
    const data = backupData(characters.slice(0, 2), island);
    const future = { ...data, v: BACKUP_VERSION + 1, extras: { pets: ['cat'] } };
    const { backup, fromNewer } = await readBackup(JSON.stringify(future));
    expect(fromNewer).toBe(true);
    expect(backup.characters).toHaveLength(2);
  });
});
