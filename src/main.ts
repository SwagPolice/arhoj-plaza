import './style.css';
import type { Mode } from './mode';
import { createEnvironment, createRenderer } from './scene/stage';
import { Editor } from './editor/editor';
import { Plaza } from './plaza/plaza';
import { Studio } from './studio/studio';
import { DebugGrid } from './debug/grid';
import { defaultRecipe } from './character/recipe';
import { loadAll, loadMode, saveMode, type GameMode } from './storage';
import { decodeCharacter, decodeIsland, ShareError } from './share';
import { openBackupDialog, takeFlash } from './ui/backup-dialog';
import { openStartScreen } from './ui/start-screen';
import { button, el } from './ui/dom';

type ModeName = 'make' | 'plaza' | 'studio';

const app = document.querySelector<HTMLDivElement>('#app')!;
const stage = el('div', 'stage');
const ui = el('div', 'ui');
app.append(stage, ui);

const renderer = createRenderer(stage);
const env = createEnvironment(renderer);

let current: Mode;
const modes: Mode[] = [];

if (new URLSearchParams(location.search).get('debug') === 'grid') {
  current = new DebugGrid(renderer, env);
  modes.push(current);
} else {
  const editor = new Editor(renderer, env, ui);
  const plaza = new Plaza(renderer, env, ui, {
    edit: (r) => {
      editor.load(r);
      go('make');
    },
    create: () => {
      editor.load(defaultRecipe());
      go('make');
    },
  });
  const studio = new Studio(renderer, env, ui);
  if (import.meta.env.DEV) Object.assign(window, { __studio: studio }); // lets browser tests find things on screen
  const byName: Record<ModeName, Mode> = { make: editor, plaza, studio };
  modes.push(editor, plaza, studio);

  // Creative shows Make and Plaza; Studio shows only its island. ⇄ switches, 💾 backs up both.
  const tabs = el('nav', 'tabs');
  const tabButtons: Record<ModeName, HTMLButtonElement> = {
    make: button('✏️ Make', '', () => openMaker()),
    plaza: button('🏝️ Plaza', '', () => go('plaza')),
    studio: button('🏺 Studio', '', () => go('studio')),
  };
  const switcher = button('⇄', 'tab-icon', () => openStartScreen(play, gameOf(currentName)));
  switcher.title = 'Switch between Creative and Studio';
  const backup = button('💾', 'tab-icon', () => openBackupDialog());
  backup.title = 'Backup & move';
  tabs.append(tabButtons.make, tabButtons.plaza, tabButtons.studio, switcher, backup);
  ui.append(tabs, el('div', 'fan-note', 'Fan project · not affiliated with Studio Arhoj'));

  const gameOf = (name: ModeName): GameMode => (name === 'studio' ? 'studio' : 'creative');
  let currentName: ModeName = 'plaza';

  function go(name: ModeName) {
    const next = byName[name];
    currentName = name;
    const game = gameOf(name);
    saveMode(game);
    tabButtons.make.style.display = tabButtons.plaza.style.display = game === 'creative' ? '' : 'none';
    tabButtons.studio.style.display = game === 'studio' ? '' : 'none';
    for (const [n, b] of Object.entries(tabButtons)) b.classList.toggle('on', n === name);
    history.replaceState(null, '', `#${name}`);
    if (next === current) return;
    current?.leave();
    current = next;
    current.enter();
  }

  /** Start (or switch to) a way of playing. */
  function play(game: GameMode) {
    if (game === 'studio') go('studio');
    else go(loadAll().length ? 'plaza' : 'make');
  }

  const hashMode = (): ModeName | null => {
    const h = location.hash.slice(1);
    return h === 'make' || h === 'plaza' || h === 'studio' ? h : null;
  };
  // The Make tab opens a new character, so a saved one is never changed by accident.
  // (Editing a saved character goes through its card's Edit button instead.)
  function openMaker() {
    if (current === plaza) editor.startFresh();
    go('make');
  }

  // Share links look like …#import=arhoj1.xxxx and open the character in the maker, unsaved.
  async function openShareLink() {
    const link = location.hash; // read it first: go() rewrites the address to #make
    go('make');
    try {
      const { recipe, fromNewer } = await decodeCharacter(link);
      editor.importRecipe(recipe, fromNewer);
    } catch (e) {
      editor.toast(e instanceof ShareError ? e.message : 'That share link could not be read.');
    }
    history.replaceState(null, '', '#make');
  }

  // Island links look like …#island=arhojisle1.xxxx and open the plaza, asking before replacing the island.
  async function openIslandLink() {
    const link = location.hash; // read it first: go() rewrites the address to #plaza
    go('plaza');
    try {
      const { layout, fromNewer } = await decodeIsland(link);
      plaza.importIsland(layout, fromNewer);
    } catch (e) {
      plaza.toast(e instanceof ShareError ? e.message : 'That island link could not be read.');
    }
    history.replaceState(null, '', '#plaza');
  }

  const openFromAddress = () => {
    const name = hashMode();
    if (location.hash.startsWith('#import=')) openShareLink();
    else if (location.hash.startsWith('#island=')) openIslandLink();
    else if (name === 'make') openMaker();
    else if (name) go(name);
    else return false;
    return true;
  };
  window.addEventListener('hashchange', openFromAddress);
  if (!openFromAddress()) {
    const saved = loadMode();
    if (saved) play(saved);
    else {
      // First visit (or the first since Studio Mode arrived): show the island behind, and ask.
      play('creative');
      openStartScreen(play);
    }
  }
  const flash = takeFlash();
  if (flash) ((currentName as ModeName) === 'studio' ? studio : plaza).toast(flash);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  for (const m of modes) m.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  current.update(dt, now / 1000);
  renderer.render(current.scene, current.camera);
});
