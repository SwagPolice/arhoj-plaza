import './style.css';
import type { Mode } from './mode';
import { createEnvironment, createRenderer } from './scene/stage';
import { Editor } from './editor/editor';
import { Plaza } from './plaza/plaza';
import { DebugGrid } from './debug/grid';
import { defaultRecipe } from './character/recipe';
import { loadAll } from './storage';
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
  ui.append(tabs);

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

  window.addEventListener('hashchange', () => {
    const name = hashMode();
    if (name === 'make') openMaker();
    else if (name) go(name);
  });
  go(hashMode() ?? (loadAll().length ? 'plaza' : 'make'));
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
