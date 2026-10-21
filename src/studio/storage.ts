/*
 * Storage: decorations (and wells or the bowl) kept off the island until you want them out.
 * Things bought or found go here first; Arrange puts them out and away again. No limit.
 * Pure functions, like economy.ts.
 */
import { DECOR_KINDS, newDecorId, placeItem, SIZES, startSize, type Decor, type DecorKind } from '../scene/layout';
import type { StudioState } from './state';

/** Anything can be put away except the harbour, which belongs on its edge. */
export const canStore = (kind: DecorKind) => kind !== 'harbour';

/** Add something new to storage (bought or found). */
export function store(s: StudioState, kind: DecorKind): StudioState {
  return { ...s, storage: [...s.storage, { id: newDecorId(kind), kind, size: startSize(kind), rot: 0 }] };
}

/** Put something on the island away. Not the harbour, and not the bowl while it's stirring. */
export function putAway(s: StudioState, id: string): StudioState | null {
  const item = s.island.items.find((d) => d.id === id);
  if (!item || !canStore(item.kind)) return null;
  if (item.kind === 'bowl' && s.bowl) return null;
  return {
    ...s,
    island: { ...s.island, items: s.island.items.filter((d) => d !== item) },
    storage: [...s.storage, { id: item.id, kind: item.kind, size: item.size, rot: item.rot, ...(item.colour ? { colour: item.colour } : {}) }],
  };
}

/** Bring one thing of this kind out onto the island (the one put away longest ago), or null if none or no room. */
export function takeOut(s: StudioState, kind: DecorKind): { state: StudioState; item: Decor } | null {
  const thing = s.storage.find((d) => d.kind === kind);
  if (!thing) return null;
  const { min, max } = SIZES[kind];
  const item = placeItem(s.island, { ...thing, size: Math.min(max, Math.max(min, thing.size)) });
  if (!item) return null;
  return {
    state: { ...s, island: { ...s.island, items: [...s.island.items, item] }, storage: s.storage.filter((d) => d !== thing) },
    item,
  };
}

/** Can this be dyed? Everything with one glazed main part: not ponds, the harbour, the mosaic or the rainbow pot. */
export const canDye = (kind: DecorKind) => !['pond', 'harbour', 'mosaic', 'rainbow'].includes(kind); // not water, nor the many-coloured pieces

/**
 * Dye a decoration's main part with a paint you own (1 paint), or back to white bisque (`colour` null, free).
 * Null if it can't be dyed, you have no such paint, or it's already that colour.
 */
export function dye(s: StudioState, id: string, colour: string | null): StudioState | null {
  const item = s.island.items.find((d) => d.id === id);
  if (!item || !canDye(item.kind) || (item.colour ?? null) === colour) return null;
  let purse = s.purse;
  if (colour) {
    if ((purse.paint[colour] ?? 0) < 1) return null;
    purse = { ...purse, paint: { ...purse.paint, [colour]: purse.paint[colour] - 1 } };
  }
  const items = s.island.items.map((d) => {
    if (d !== item) return d;
    const { colour: _, ...rest } = d;
    return colour ? { ...rest, colour } : rest;
  });
  return { ...s, purse, island: { ...s.island, items } };
}

/** What's stored, by kind, in the usual order of kinds. */
export function stored(s: StudioState): { kind: DecorKind; count: number }[] {
  return DECOR_KINDS.map((kind) => ({ kind, count: s.storage.filter((d) => d.kind === kind).length })).filter((k) => k.count > 0);
}
