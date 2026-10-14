import './style.css';
import type { Mode } from './mode';
import { createEnvironment, createRenderer } from './scene/stage';
import { Editor } from './editor/editor';
import { Plaza } from './plaza/plaza';
import { DebugGrid } from './debug/grid';
import { defaultRecipe } from './character/recipe';
import { loadAll } from './storage';
import { decodeCharacter, decodeIsland, ShareError } from './share';
import { button, el } from './ui/dom';

type ModeName = 'make' | 'plaza';

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
  const byName: Record<ModeName, Mode> = { make: editor, plaza };
  modes.push(editor, plaza);

  const tabs = el('nav', 'tabs');
  const tabButtons = {
    make: button('✏️ Make', '', () => openMaker()),
    plaza: button('🏝️ Plaza', '', () => go('plaza')),
  };
  tabs.append(tabButtons.make, tabButtons.plaza);
  ui.append(tabs, el('div', 'fan-note', 'Fan project · not affiliated with Studio Arhoj'));

  function go(name: ModeName) {
    const next = byName[name];
    if (next === current) return;
    current?.leave();
    current = next;
    current.enter();
    for (const [n, b] of Object.entries(tabButtons)) b.classList.toggle('on', n === name);
    history.replaceState(null, '', `#${name}`);
  }

  const hashMode = (): ModeName | null => {
    const h = location.hash.slice(1);
    return h === 'make' || h === 'plaza' ? h : null;
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
  if (!openFromAddress()) go(loadAll().length ? 'plaza' : 'make');
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
