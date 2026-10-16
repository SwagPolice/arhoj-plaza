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
    storage: [...s.storage, { id: item.id, kind: item.kind, size: item.size, rot: item.rot }],
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

/** What's stored, by kind, in the usual order of kinds. */
export function stored(s: StudioState): { kind: DecorKind; count: number }[] {
  return DECOR_KINDS.map((kind) => ({ kind, count: s.storage.filter((d) => d.kind === kind).length })).filter((k) => k.count > 0);
}
