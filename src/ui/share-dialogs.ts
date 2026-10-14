import { ShareError } from '../share';
import { button, el } from './dom';

/** Share dialog: the code, plus buttons to copy it or a link. */
export function openShareDialog(title: string, blurb: string, code: string, link: string) {
  const box = el('textarea', 'code-box');
  box.readOnly = true;
  box.value = code;
  box.addEventListener('focus', () => box.select());
  openDialog(title, [el('p', 'muted', blurb), box, row(copyButton('Copy code', () => code, box), copyButton('Copy link', () => link, box))]);
}

/** Import dialog: paste a code, `use` reads it. Problems with the code are shown in the dialog. */
export function openImportDialog(title: string, placeholder: string, use: (text: string) => Promise<void>) {
  const box = el('textarea', 'code-box');
  box.placeholder = placeholder;
  const error = el('p', 'error');
  const dialog = openDialog(title, [
    box,
    error,
    row(
      button('Import', 'btn primary', async () => {
        try {
          await use(box.value);
          dialog.close();
        } catch (e) {
          error.textContent = e instanceof ShareError ? e.message : 'Something went wrong reading that code.';
        }
      }),
    ),
  ]);
  box.focus();
}

/** A button that copies text, with a fallback when the browser blocks the clipboard. */
export function copyButton(label: string, text: () => string | Promise<string>, fallback?: HTMLTextAreaElement) {
  const b = button(label, 'btn', async () => {
    const value = await text();
    try {
      await navigator.clipboard.writeText(value);
      b.textContent = 'Copied ✓';
    } catch {
      if (fallback) {
        fallback.value = value;
        fallback.select(); // leave it selected for ⌘C
      }
      b.textContent = 'Press ⌘C to copy';
    }
    setTimeout(() => (b.textContent = label), 1800);
  });
  return b;
}

export function row(...children: HTMLElement[]) {
  const r = el('div', 'actions');
  r.append(...children);
  return r;
}

/** A small modal with a title and a Close button. Removes itself when closed. */
export function openDialog(title: string, body: HTMLElement[]) {
  const d = el('dialog', 'dialog');
  const close = button('×', 'dialog-close', () => d.close());
  close.title = 'Close';
  d.append(close, el('h3', '', title), ...body);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => e.target === d && d.close()); // click outside
  document.body.append(d);
  d.showModal();
  return d;
}
