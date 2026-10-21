/*
 * The residents list: everyone who lives on the island, in either mode, with chips to count and filter them
 * by trait or personality. Each mode says what's shown for a resident and what can be done (Find, Rename…).
 */
import { button, el } from './dom';
import { openDialog } from './share-dialogs';

export type Action = { label: string; run: () => void; primary?: boolean; off?: string }; // off: why it can't be done now
export type Resident = {
  id: string;
  name: string;
  swatch: string; // their glaze colour (or clay)
  facts: string[]; // short lines under the name
  tags: string[]; // the chips they count under
  actions: Action[];
};
export type Tag = { key: string; label: string };

/** How many residents carry each tag, in the tags' order, leaving out tags nobody has. */
export function countTags(residents: Resident[], tags: Tag[]): (Tag & { n: number })[] {
  return tags.map((t) => ({ ...t, n: residents.filter((r) => r.tags.includes(t.key)).length })).filter((t) => t.n > 0);
}

/** Only those with this tag (everyone if none). */
export const filterBy = (residents: Resident[], key: string | null) => (key ? residents.filter((r) => r.tags.includes(key)) : residents);

export type ResidentsDialog = { dialog: HTMLDialogElement; redraw: () => void };

/**
 * Open the list. `list` is asked again on `redraw` (after an action changed someone, so it shows at once);
 * `say` explains why an action that's off can't be done right now.
 */
export function openResidents(o: { title: string; intro?: string; list: () => Resident[]; tags: Tag[]; say: (why: string) => void }): ResidentsDialog {
  const { title, intro, list, tags, say } = o;
  let filter: string | null = null;
  const chips = el('div', 'chips residents-chips');
  const rows = el('div', 'residents');
  const draw = () => {
    const all = list();
    const counts = countTags(all, tags);
    if (filter && !counts.some((t) => t.key === filter)) filter = null; // the last of them left
    chips.style.display = all.length ? '' : 'none';
    chips.replaceChildren(
      button(`Everyone ${all.length}`, 'chip' + (filter ? '' : ' on'), () => ((filter = null), draw())),
      ...counts.map((t) => button(`${t.label} ${t.n}`, 'chip' + (filter === t.key ? ' on' : ''), () => ((filter = filter === t.key ? null : t.key), draw()))),
    );
    rows.replaceChildren(
      ...filterBy(all, filter).map((r) => {
        const row = el('div', 'resident');
        const dot = el('span', 'resident-swatch');
        dot.style.background = r.swatch;
        const text = el('div', 'resident-text');
        text.append(el('div', 'resident-name', r.name || 'Unnamed'), ...r.facts.map((f) => el('div', 'muted resident-fact', f)));
        const acts = el('div', 'resident-actions');
        for (const a of r.actions) {
          const b = button(a.label, 'btn small' + (a.primary ? ' primary' : '') + (a.off ? ' off' : ''), () => {
            if (a.off) return say(a.off);
            a.run();
          });
          if (a.off) b.title = a.off;
          acts.append(b);
        }
        row.append(dot, text, acts);
        return row;
      }),
    );
  };
  draw();
  const dialog = openDialog(title, [...(intro ? [el('p', 'muted', intro)] : []), chips, rows]);
  dialog.classList.add('residents-dialog');
  return { dialog, redraw: draw };
}
