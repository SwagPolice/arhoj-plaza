import { hasStudio, saveMode, saveStudio, stopSaving, type GameMode } from '../storage';
import { newStudio } from '../studio/state';
import { button, el } from './dom';

/** Choose how to play. Shown on a first visit, and from the ⇄ button to switch. */
export function openStartScreen(choose: (mode: GameMode) => void, current: GameMode | null = null) {
  const screen = el('div', 'start-screen');
  const card = (mode: GameMode, emoji: string, title: string, blurb: string) => {
    const b = button('', 'start-card' + (mode === current ? ' on' : ''), () => {
      screen.remove();
      choose(mode);
    });
    b.append(el('span', 'start-emoji', emoji), el('span', 'start-title', title), el('span', 'start-blurb', blurb));
    return b;
  };
  const cards = el('div', 'start-cards');
  cards.append(
    card('creative', '🎨', 'Creative', 'Everything unlocked: make characters and decorate your island freely.'),
    card('studio', '🏺', 'Studio', 'Start with one bare clay ghost and earn everything, one drop of clay at a time.'),
  );
  const inner = el('div', 'start-inner');
  inner.append(el('h1', '', 'Arhoj Plaza'), el('p', 'muted', 'How would you like to play? You can switch any time.'), cards);
  if (current) inner.append(button('Keep playing ' + (current === 'studio' ? 'Studio' : 'Creative'), 'btn', () => screen.remove()));
  // A fresh Studio: one bare ghost again. Creative is left alone.
  if (current && hasStudio()) {
    inner.append(
      button('Start the Studio over', 'btn start-over', () => {
        if (!confirm('Start the Studio over? Your Studio characters, island and everything collected there will be gone. Creative stays as it is.')) return;
        saveStudio(newStudio());
        saveMode('studio');
        stopSaving(); // so the old studio isn't saved again on the way out
        location.hash = '#studio';
        location.reload();
      }),
    );
  }
  screen.append(inner);
  document.body.append(screen);
}
