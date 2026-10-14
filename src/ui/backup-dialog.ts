import { backupCode, backupFileName, backupFileText, newCharacters, readBackup, type Backup } from '../backup';
import { loadAll, loadIsland, replaceAll, saveIsland } from '../storage';
import { ShareError } from '../share';
import { button, el } from './dom';
import { copyButton, openDialog, row } from './share-dialogs';

const FLASH_KEY = 'arhoj-plaza.flash';

/** Backup & move: save everything to a file or code, or restore from one. */
export function openBackupDialog() {
  const characters = loadAll();
  const island = loadIsland();
  const count = characters.length === 1 ? '1 character' : `${characters.length} characters`;

  // ----- save -----
  const fallback = el('textarea', 'code-box');
  fallback.readOnly = true;
  fallback.style.display = 'none'; // only shown if the clipboard is blocked
  const download = button('⬇ Download backup file', 'btn primary', () => {
    const url = URL.createObjectURL(new Blob([backupFileText(characters, island)], { type: 'application/json' }));
    const a = el('a');
    a.href = url;
    a.download = backupFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const copy = copyButton('Copy backup code', async () => {
    const code = await backupCode(characters, island);
    fallback.style.display = '';
    fallback.value = code;
    return code;
  }, fallback);

  // ----- restore -----
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.style.display = 'none';
  const paste = el('textarea', 'code-box');
  paste.placeholder = 'Or paste a backup code here';
  const error = el('p', 'error');
  const result = el('div', 'backup-result');

  const show = (backup: Backup, fromNewer: boolean) => {
    error.textContent = '';
    const theirs = backup.characters.length === 1 ? '1 character' : `${backup.characters.length} characters`;
    const made = backup.made ? `, made ${new Date(backup.made).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
    const islandToo = el('input');
    islandToo.type = 'checkbox';
    const islandLabel = el('label', 'backup-check');
    islandLabel.append(islandToo, ' Also use its island (replaces yours)');
    result.replaceChildren(
      el('p', 'backup-summary', `This backup has ${theirs} and an island${made}.`),
      ...(fromNewer ? [el('p', 'muted', 'It was made with a newer version of the game, so a few details may be missing.')] : []),
      islandLabel,
      row(
        button('Add to mine', 'btn', () => {
          const mine = loadAll();
          const added = newCharacters(mine, backup.characters);
          replaceAll([...mine, ...added]);
          if (islandToo.checked) saveIsland(backup.island);
          const already = backup.characters.length - added.length;
          const what = added.length === 1 ? '1 character' : `${added.length} characters`;
          if (!added.length && !islandToo.checked) {
            error.textContent = 'Nothing new to add: every character in this backup is already here.';
            return;
          }
          finish(
            (added.length ? `Added ${what}` : 'Added the island') +
              (already ? ` (${already} ${already === 1 ? 'was' : 'were'} already here)` : '') +
              (added.length && islandToo.checked ? ' and the island.' : '.'),
          );
        }),
        button('Replace everything', 'btn danger', () => {
          // Only ask when there's something here to lose.
          if (loadAll().length && !confirm(`Replace everything on this device with the backup? Your ${count} and your island here will be lost.`)) return;
          replaceAll(backup.characters);
          saveIsland(backup.island);
          finish(`Restored ${theirs} and the island.`);
        }),
      ),
    );
  };

  const read = async (text: string) => {
    try {
      const { backup, fromNewer } = await readBackup(text);
      show(backup, fromNewer);
    } catch (e) {
      result.replaceChildren();
      error.textContent = e instanceof ShareError ? e.message : 'Something went wrong reading that backup.';
    }
  };
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (f) await read(await f.text());
    file.value = '';
  });
  paste.addEventListener('input', () => paste.value.trim() && read(paste.value));

  openDialog('Backup & move', [
    el('p', 'muted', `Everything in this browser (your ${count} and your island) in one file or code. Use it to move your plaza to another browser or device.`),
    row(download, copy),
    fallback,
    el('h4', 'backup-heading', 'Restore'),
    row(button('📂 Open a backup file', 'btn', () => file.click())),
    file,
    paste,
    error,
    result,
  ]);
}

/** After restoring: reload into the plaza, then say what happened. */
function finish(message: string) {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    // no message then, the restore itself still worked
  }
  location.hash = '#plaza';
  location.reload();
}

/** A message left by a restore just before the page reloaded (shown once). */
export function takeFlash(): string | null {
  try {
    const m = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return m;
  } catch {
    return null;
  }
}
