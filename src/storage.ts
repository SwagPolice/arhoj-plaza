import { normaliseRecipe, RECIPE_VERSION, type CharacterRecipe } from './character/recipe';
import { defaultLayout, LAYOUT_VERSION, normaliseLayout, type IslandLayout } from './scene/layout';

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

function writeAll(list: CharacterRecipe[]) {
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
  try {
    localStorage.setItem(ISLAND_KEY, JSON.stringify({ v: LAYOUT_VERSION, ...layout }));
  } catch {
    // Storage unavailable: the island still works, it just won't be remembered.
  }
}
