import { normaliseRecipe, type CharacterRecipe } from './character/recipe';

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
    localStorage.setItem(KEY, JSON.stringify(list));
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
