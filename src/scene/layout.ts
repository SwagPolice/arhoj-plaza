/*
 * The island as data: its size and the decorations on it. Saved in the browser, so the same rules as
 * character recipes apply (see the top of src/character/recipe.ts): new things get defaults, shipped
 * values are never renamed, removed kinds are mapped or dropped, and meaning changes bump LAYOUT_VERSION
 * with a step in MIGRATIONS. `npm test` (tests/island.test.ts) checks frozen layouts still load.
 */
import type { Obstacle } from '../plaza/behaviour';
import { between } from '../util/random';

export const DECOR_KINDS = ['tree', 'pond', 'rock', 'mushroom', 'well', 'bowl', 'shell', 'seaglass', 'harbour', 'driftwood', 'coral'] as const; // well, bowl, harbour: Studio Mode only
export type DecorKind = (typeof DECOR_KINDS)[number];

/**
 * One decoration. `size` is a scale for trees, mushrooms, shells and sea glass, and a radius for ponds and rocks.
 * `rot` is how far it's turned, in radians (added after version 1 shipped; missing means 0).
 */
export type Decor = { id: string; kind: DecorKind; x: number; z: number; size: number; rot: number };
export type IslandLayout = { radius: number; items: Decor[] };

export const ISLAND_SIZE = { min: 5, max: 11 };
export const MAX_DECOR = 40;
const EDGE = 0.2; // keep things off the rim

export const SIZES: Record<DecorKind, { min: number; max: number }> = {
  tree: { min: 0.6, max: 1.6 },
  pond: { min: 0.8, max: 2 },
  rock: { min: 0.2, max: 0.8 },
  mushroom: { min: 0.6, max: 1.6 },
  well: { min: 1, max: 1 },
  bowl: { min: 1, max: 1 },
  shell: { min: 0.6, max: 1.6 },
  seaglass: { min: 0.6, max: 1.6 },
  harbour: { min: 1, max: 1 },
  driftwood: { min: 0.6, max: 1.6 },
  coral: { min: 0.6, max: 1.6 },
};

/** Only things that aren't round from above look any different when turned. Add new non-round kinds here. */
export const canTurn = (kind: DecorKind) => ['rock', 'shell', 'seaglass', 'driftwood', 'coral'].includes(kind);

/** The harbour belongs on the island's edge, facing the sea: it stays where it was built. */
export const canMove = (kind: DecorKind) => kind !== 'harbour';

/** Trees, ponds and rocks block walking and can't overlap each other; little things (mushrooms, shells…) are walk-through. */
export const blocksWalking = (kind: DecorKind) => !['mushroom', 'shell', 'seaglass', 'driftwood', 'coral'].includes(kind);

/** How much ground an object takes up (a circle of this radius). */
export function footprint(d: Pick<Decor, 'kind' | 'size'>): number {
  if (d.kind === 'tree') return 0.7 * d.size;
  if (d.kind === 'pond') return d.size + 0.3;
  if (d.kind === 'rock') return d.size + 0.1;
  if (d.kind === 'well') return 0.7 * d.size;
  if (d.kind === 'bowl') return 0.6 * d.size;
  if (d.kind === 'shell') return 0.32 * d.size;
  if (d.kind === 'seaglass') return 0.18 * d.size;
  if (d.kind === 'harbour') return 0.55; // the landward end; the pier itself reaches out over the water
  if (d.kind === 'driftwood') return 0.5 * d.size;
  if (d.kind === 'coral') return 0.3 * d.size;
  return 0.15 * d.size;
}

/** The island as it was before decorating existed: the same trees, rocks, pond and mushrooms. */
export function defaultLayout(): IslandLayout {
  const trees: [number, number, number][] = [[-4.6, -2.6, 1.1], [4.2, -3.6, 1.3], [5.0, 2.2, 0.95], [-0.8, -5.4, 1.15], [1.6, 5.6, 0.9]];
  const rocks: [number, number, number][] = [[2.6, 3.0, 0.45], [-5.4, 1.0, 0.38], [1.2, -2.6, 0.32]];
  const mushrooms: [number, number][] = [[-3.31, -1.31], [-0.68, 2.42], [0.08, 6.38], [-6.11, -1.01], [3.2, -5.5], [4.02, 3.81]];
  return {
    radius: 7.5,
    items: [
      { id: 'pond-1', kind: 'pond', x: -2.8, z: 2.6, size: 1.3, rot: 0 },
      ...trees.map(([x, z, size], i) => ({ id: `tree-${i + 1}`, kind: 'tree' as const, x, z, size, rot: 0 })),
      ...rocks.map(([x, z, size], i) => ({ id: `rock-${i + 1}`, kind: 'rock' as const, x, z, size, rot: 0 })),
      ...mushrooms.map(([x, z], i) => ({ id: `mushroom-${i + 1}`, kind: 'mushroom' as const, x, z, size: 1, rot: 0 })),
    ],
  };
}

// ---------- placement ----------

/** Can `item` stand at (x, z)? Fully on the island, and not overlapping anything it shouldn't. */
export function canPlace(layout: IslandLayout, item: Decor, x: number, z: number): boolean {
  const fp = footprint(item);
  if (Math.hypot(x, z) + fp > layout.radius - EDGE) return false;
  return layout.items.every((o) => {
    if (o.id === item.id) return true;
    const d = Math.hypot(x - o.x, z - o.z);
    if (blocksWalking(item.kind) && blocksWalking(o.kind)) return d >= fp + footprint(o);
    if (blocksWalking(item.kind)) return d >= fp + 0.05; // a big thing may not land on a mushroom
    if (blocksWalking(o.kind)) return d >= footprint(o) + 0.05; // a mushroom may sit right next to a tree
    return d >= Math.max(0.25, (fp + footprint(o)) * 0.8); // little things just don't stack
  });
}

/** A new object of this kind, at the free spot closest to the middle, or null if the island is full. */
export function placeNew(layout: IslandLayout, kind: DecorKind): Decor | null {
  return placeItem(layout, { id: newDecorId(kind), kind, size: startSize(kind), rot: 0 });
}

/** A typical size for a new object of this kind. */
export const startSize = (kind: DecorKind) =>
  kind === 'tree' ? round2(between(0.9, 1.3)) : kind === 'pond' ? round2(between(1.1, 1.4)) : kind === 'rock' ? round2(between(0.3, 0.5)) : 1;

/** An existing object (e.g. out of storage, keeping its id, size and turn) at the free spot closest to the middle. */
export function placeItem(layout: IslandLayout, thing: Omit<Decor, 'x' | 'z'>): Decor | null {
  if (layout.items.length >= MAX_DECOR) return null;
  const item: Decor = { ...thing, x: 0, z: 0 };
  const start = Math.random() * Math.PI * 2; // so new things don't always line up the same way
  for (let r = 0; r <= layout.radius; r += 0.35) {
    const steps = Math.max(1, Math.ceil((2 * Math.PI * r) / 0.35));
    for (let i = 0; i < steps; i++) {
      const a = start + (i / steps) * Math.PI * 2;
      const x = round2(Math.cos(a) * r);
      const z = round2(Math.sin(a) * r);
      if (canPlace(layout, item, x, z)) return { ...item, x, z };
    }
  }
  return null;
}

/**
 * A new object on the island's edge, turned to face out to sea (the harbour), or null if the edge is full.
 * It looks from the left side round both ways: there it's in view, clear of the build bar at the bottom.
 */
export function placeAtEdge(layout: IslandLayout, kind: DecorKind): Decor | null {
  if (layout.items.length >= MAX_DECOR) return null;
  const item: Decor = { id: newDecorId(kind), kind, x: 0, z: 0, size: 1, rot: 0 };
  const r = layout.radius - footprint(item) - EDGE - 0.01;
  const start = Math.atan2(-1, 0.25); // the left side, a little towards the camera (an angle from +z towards +x)
  for (let i = 0; i <= 72; i++) {
    const a = start + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 36);
    const x = round2(Math.sin(a) * r);
    const z = round2(Math.cos(a) * r);
    if (canPlace(layout, item, x, z)) return { ...item, x, z, rot: round2(((a % TAU) + TAU) % TAU) };
  }
  return null;
}

/**
 * The free spot closest to (x, z) for this item: (x, z) itself if it's free, otherwise the nearest place it fits,
 * searching outward in rings. Null if it fits nowhere on the island.
 */
export function nearestFreeSpot(layout: IslandLayout, item: Decor, x: number, z: number): { x: number; z: number } | null {
  if (canPlace(layout, item, x, z)) return { x: round2(x), z: round2(z) };
  const step = 0.2;
  const furthest = layout.radius * 2; // far enough to reach any spot on the island from anywhere on it
  for (let r = step; r <= furthest; r += step) {
    const steps = Math.ceil((2 * Math.PI * r) / step);
    let best: { x: number; z: number; d: number } | null = null;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = round2(x + Math.cos(a) * r);
      const pz = round2(z + Math.sin(a) * r);
      if (!canPlace(layout, item, px, pz)) continue;
      const d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) best = { x: px, z: pz, d };
    }
    if (best) return { x: best.x, z: best.z };
  }
  return null;
}

/** The biggest this item can grow where it stands without overlapping anything or leaving the island. */
export function maxSizeHere(layout: IslandLayout, item: Decor): number {
  const { min, max } = SIZES[item.kind];
  const fits = (size: number) => canPlace(layout, { ...item, size }, item.x, item.z);
  if (fits(max)) return max;
  if (!fits(min)) return Math.max(min, Math.min(item.size, max));
  let lo = min;
  let hi = max;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 100) / 100;
}

const TAU = Math.PI * 2;
/** Turn by `delta` radians, kept between 0 and a full turn. */
export const turned = (rot: number, delta: number) => round2((((rot + delta) % TAU) + TAU) % TAU);

/** The smallest island that still fits everything on it. */
export function minRadius(layout: IslandLayout): number {
  const needed = Math.max(0, ...layout.items.map((d) => Math.hypot(d.x, d.z) + footprint(d) + EDGE));
  return Math.min(ISLAND_SIZE.max, Math.max(ISLAND_SIZE.min, Math.ceil(needed * 10) / 10));
}

/** What characters walk around. */
export function obstaclesFor(layout: IslandLayout): Obstacle[] {
  return layout.items.filter((d) => blocksWalking(d.kind)).map((d) => ({ x: d.x, z: d.z, r: footprint(d) }));
}

const round2 = (n: number) => Math.round(n * 100) / 100 || 0; // `|| 0` turns -0 into 0
export const newDecorId = (kind: DecorKind) => `${kind}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- loading saved data ----------

export const LAYOUT_VERSION = 1;

type Raw = Record<string, unknown>;

// MIGRATIONS[n] upgrades version n data to n + 1. Layouts started at version 1, so there's nothing yet.
const MIGRATIONS: Record<number, (o: Raw) => Raw> = {};

function upgrade(o: Raw): Raw {
  let v = typeof o.v === 'number' ? o.v : LAYOUT_VERSION;
  let data = o;
  while (v < LAYOUT_VERSION) data = MIGRATIONS[v++](data);
  return data;
}

const clamp = (v: unknown, range: { min: number; max: number }, fb: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : fb;

/** Turn anything loaded from storage into a valid layout. Unknown kinds (e.g. from a newer version) are left out. */
export function normaliseLayout(raw: unknown): IslandLayout {
  if (!raw || typeof raw !== 'object') return defaultLayout();
  const o = upgrade(raw as Raw);
  const radius = clamp(o.radius, ISLAND_SIZE, defaultLayout().radius);
  const items: Decor[] = [];
  for (const r of Array.isArray(o.items) ? o.items : []) {
    if (!r || typeof r !== 'object' || items.length >= MAX_DECOR) continue;
    const d = r as Raw;
    if (!(DECOR_KINDS as readonly unknown[]).includes(d.kind)) continue;
    const kind = d.kind as DecorKind;
    const size = clamp(d.size, SIZES[kind], 1 < SIZES[kind].min || 1 > SIZES[kind].max ? SIZES[kind].min : 1);
    let x = clamp(d.x, { min: -radius, max: radius }, 0);
    let z = clamp(d.z, { min: -radius, max: radius }, 0);
    // Pull anything hanging off the edge back onto the island.
    const max = radius - EDGE - footprint({ kind, size });
    const dist = Math.hypot(x, z);
    if (dist > max) [x, z] = [round2((x / dist) * Math.max(0, max)), round2((z / dist) * Math.max(0, max))];
    const id = typeof d.id === 'string' && d.id && !items.some((i) => i.id === d.id) ? d.id : newDecorId(kind);
    const rot = typeof d.rot === 'number' && Number.isFinite(d.rot) ? turned(d.rot, 0) : 0;
    items.push({ id, kind, x, z, size, rot });
  }
  return { radius, items };
}
