import { normaliseRecipe, RECIPE_VERSION, type CharacterRecipe } from './character/recipe';
import { defaultLayout, LAYOUT_VERSION, normaliseLayout, type IslandLayout } from './scene/layout';
import { newStudio, normaliseStudio, studioData, type StudioState } from './studio/state';

const KEY = 'arhoj-plaza.characters.v1';

export function loadAll(): CharacterRecipe[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(normaliseRecipe) : [];
  } catch {
    return [];
  }
}

/** Restoring a backup reloads the page; after `stopSaving()` nothing on the way out may overwrite it. */
let saving = true;
export function stopSaving() {
  saving = false;
}

function writeAll(list: CharacterRecipe[]) {
  if (!saving) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map((r) => ({ v: RECIPE_VERSION, ...r }))));
  } catch {
    // Storage can be unavailable (private mode); the game still runs, it just won't remember.
  }
}

export function saveOne(recipe: CharacterRecipe) {
  const list = loadAll();
  const i = list.findIndex((r) => r.id === recipe.id);
  if (i >= 0) list[i] = recipe;
  else list.push(recipe);
  writeAll(list);
}

export function removeOne(id: string) {
  writeAll(loadAll().filter((r) => r.id !== id));
}

/** Replace every saved character at once (restoring a backup). */
export function replaceAll(list: CharacterRecipe[]) {
  writeAll(list);
}

export function removeAll() {
  writeAll([]);
}

// ---------- the island ----------

const ISLAND_KEY = 'arhoj-plaza.island.v1';

export function loadIsland(): IslandLayout {
  try {
    const raw = localStorage.getItem(ISLAND_KEY);
    return raw ? normaliseLayout(JSON.parse(raw)) : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

export function saveIsland(layout: IslandLayout) {
  if (!saving) return;
  try {
    localStorage.setItem(ISLAND_KEY, JSON.stringify({ v: LAYOUT_VERSION, ...layout }));
  } catch {
    // Storage unavailable: the island still works, it just won't be remembered.
  }
}

// ---------- Studio Mode ----------

const STUDIO_KEY = 'arhoj-plaza.studio.v1';
const MODE_KEY = 'arhoj-plaza.mode';

export function loadStudio(): StudioState {
  try {
    const raw = localStorage.getItem(STUDIO_KEY);
    return raw ? normaliseStudio(JSON.parse(raw)) : newStudio();
  } catch {
    return newStudio();
  }
}

export function saveStudio(s: StudioState) {
  if (!saving) return;
  try {
    localStorage.setItem(STUDIO_KEY, JSON.stringify(studioData(s)));
  } catch {
    // Storage unavailable: the studio still runs, it just won't be remembered.
  }
}

export function hasStudio(): boolean {
  try {
    return localStorage.getItem(STUDIO_KEY) !== null;
  } catch {
    return false;
  }
}

export type GameMode = 'creative' | 'studio';

/** The mode played last time, or null on a first visit (then the start screen asks). */
export function loadMode(): GameMode | null {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'creative' || m === 'studio' ? m : null;
  } catch {
    return null;
  }
}

export function saveMode(m: GameMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // fine: the start screen just asks again next time
  }
}
