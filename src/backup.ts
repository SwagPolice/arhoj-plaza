/*
 * Backups: everything this browser knows (all characters and the island) in one file or code,
 * to move a plaza to another browser or device. Same safety rules as share codes: a version number,
 * old backups keep loading (tests/backup.test.ts), and newer ones load as closely as possible.
 */
import { normaliseRecipe, RECIPE_VERSION, type CharacterRecipe } from './character/recipe';
import { LAYOUT_VERSION, normaliseLayout, type IslandLayout } from './scene/layout';
import { BACKUP_PREFIX, codeFrom, codeKind, pack, ShareError, unpack } from './share';

export const BACKUP_VERSION = 1;

export type Backup = { characters: CharacterRecipe[]; island: IslandLayout; made: string | null };

/** The backup as plain data: readable JSON, each part tagged with its own version. */
export function backupData(characters: CharacterRecipe[], island: IslandLayout, made = new Date()) {
  return {
    app: 'arhoj-plaza',
    kind: 'backup',
    v: BACKUP_VERSION,
    made: made.toISOString(),
    characters: characters.map((r) => ({ v: RECIPE_VERSION, ...r })),
    island: { v: LAYOUT_VERSION, ...island },
  };
}

export const backupFileText = (characters: CharacterRecipe[], island: IslandLayout) =>
  JSON.stringify(backupData(characters, island), null, 1);

export async function backupCode(characters: CharacterRecipe[], island: IslandLayout) {
  return BACKUP_PREFIX + (await pack(backupData(characters, island)));
}

export const backupFileName = (date = new Date()) => `arhoj-plaza-backup-${date.toISOString().slice(0, 10)}.json`;

/** Read a backup from a file's text or a pasted code. */
export async function readBackup(input: string): Promise<{ backup: Backup; fromNewer: boolean }> {
  const text = input.trim();
  let raw: unknown;
  if (text.startsWith('{')) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ShareError("This file isn't a backup, or it got damaged.");
    }
  } else {
    const kind = codeKind(text);
    if (kind === 'character') throw new ShareError("That's a character code. Import it in the ✏️ Make tab instead.");
    if (kind === 'island') throw new ShareError("That's an island code. Import it from 🛠 Decorate in the plaza instead.");
    if (kind !== 'backup') throw new ShareError("That doesn't look like a backup code or file.");
    raw = await unpack(codeFrom(text, '#backup=').slice(BACKUP_PREFIX.length));
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (o.kind !== 'backup') throw new ShareError("This file isn't an Arhoj Plaza backup.");

  // Characters keep their ids, so a later "Add to mine" can tell which ones are already here.
  const characters: CharacterRecipe[] = [];
  for (const r of Array.isArray(o.characters) ? o.characters : []) {
    const recipe = normaliseRecipe(r);
    if (!characters.some((c) => c.id === recipe.id)) characters.push(recipe);
  }
  const newer = (x: unknown, current: number) =>
    !!x && typeof x === 'object' && typeof (x as { v?: unknown }).v === 'number' && ((x as { v: number }).v as number) > current;
  const fromNewer =
    newer(o, BACKUP_VERSION) ||
    newer(o.island, LAYOUT_VERSION) ||
    (Array.isArray(o.characters) && o.characters.some((c) => newer(c, RECIPE_VERSION)));
  return {
    backup: { characters, island: normaliseLayout(o.island), made: typeof o.made === 'string' ? o.made : null },
    fromNewer,
  };
}

/** "Add to mine": the backup's characters that aren't already here. */
export function newCharacters(mine: CharacterRecipe[], theirs: CharacterRecipe[]) {
  const here = new Set(mine.map((r) => r.id));
  return theirs.filter((r) => !here.has(r.id));
}
