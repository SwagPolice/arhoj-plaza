import type { GameMode } from '../storage';
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
  screen.append(inner);
  document.body.append(screen);
}
