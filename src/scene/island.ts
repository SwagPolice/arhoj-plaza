import * as THREE from 'three';
import { canvasTexture, glaze, makeCanvas, speckle } from './stage';
import { latheFrom, type Pt } from '../character/build';
import type { World } from '../plaza/behaviour';
import { mulberry32 } from '../util/random';
import { blocksWalking, footprint, obstaclesFor, type Decor, type IslandLayout } from './layout';

const TREE: Pt[] = [[0, 0], [0.3, 0], [0.6, 0], [0.62, 0.06], [0.5, 0.3], [0.34, 0.62], [0.18, 0.88], [0.06, 1.02], [0, 1.05]];
const GREENS = ['#8fb07a', '#a4c08a', '#7fa36f'];

export type BuiltIsland = {
  group: THREE.Group;
  world: World;
  decor: Map<string, THREE.Object3D>; // each decoration's own group, for picking and dragging
};

/**
 * A round glazed-ceramic island floating on pale water, decorated as the layout says.
 * `tints` colours a glaze well's water by its id (Studio Mode: the last colour it made).
 * `flowers: false` leaves out the scattered flowers (Studio Mode, where they'd look like paint drops).
 */
export function buildIsland(layout: IslandLayout, tints: Record<string, string> = {}, flowers = true): BuiltIsland {
  const rand = mulberry32(7);
  const R = layout.radius;
  const group = new THREE.Group();
  const clay = glaze('#c9b394', { roughness: 0.85, clearcoat: 0 });

  const grass = canvasTexture(
    makeCanvas(1024, 1024, (ctx) => {
      ctx.fillStyle = '#c5d6a3';
      ctx.fillRect(0, 0, 1024, 1024);
      speckle(ctx, 1024, 1024, rand, 1500);
    }),
    true,
  );
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.5, 96), [
    clay,
    glaze('#ffffff', { map: grass, roughness: 0.55, clearcoat: 0.4 }),
    clay,
  ]);
  ground.position.y = -0.25;

  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 16, 120), glaze('#f1e7d6'));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.02;

  const base = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.65, 1.6, 96), clay);
  base.position.y = -1.3;
  group.add(ground, rim, base);

  const decor = new Map<string, THREE.Object3D>();
  let treeCount = 0;
  for (const d of layout.items) {
    const obj =
      d.kind === 'tree' ? makeTree(d, treeCount++)
      : d.kind === 'pond' ? makePond(d)
      : d.kind === 'rock' ? makeRock(d)
      : d.kind === 'well' ? makeWell(d, tints[d.id])
      : d.kind === 'bowl' ? makeBowl(d)
      : d.kind === 'shell' ? makeShell(d)
      : d.kind === 'seaglass' ? makeSeaGlass(d)
      : makeMushroom(d);
    obj.position.set(d.x, 0, d.z);
    obj.rotation.y = d.rot;
    obj.userData.decorId = d.id;
    decor.set(d.id, obj);
    group.add(obj);
  }

  // Flowers: a seeded scatter that keeps clear of trees, ponds and rocks (characters walk through them).
  const big = layout.items.filter((d) => blocksWalking(d.kind));
  const free = (x: number, z: number) => big.every((o) => Math.hypot(x - o.x, z - o.z) > footprint(o) + 0.1);
  const flowerColours = ['#f2b8ae', '#e2b23f', '#fffaf2', '#a7cbe3'];
  const flowerCount = flowers ? Math.round(40 * (R / 7.5) ** 2) : 0;
  for (let i = 0; i < flowerCount; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const r = (R - 0.6) * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const [x, z] = [Math.cos(a) * r, Math.sin(a) * r];
      if (!free(x, z)) continue;
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glaze(flowerColours[i % flowerColours.length]));
      flower.position.set(x, 0.04, z);
      group.add(flower);
      break;
    }
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });

  const water = new THREE.Mesh(new THREE.CircleGeometry(90, 64), glaze('#cfe0dc', { roughness: 0.15, clearcoat: 0.6 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.1;
  water.receiveShadow = true;
  group.add(water);

  return { group, world: { radius: R, obstacles: obstaclesFor(layout) }, decor };
}

// Each decoration is built around its own origin, so it can be moved as one piece.

/** Ceramic tree: the same lathe trick as the characters. */
function makeTree(d: Decor, index: number) {
  const s = d.size;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.45 * s, 12), glaze('#a98462', { roughness: 0.6 }));
  trunk.position.y = 0.22 * s;
  const foliage = new THREE.Mesh(latheFrom(TREE).geo, glaze(GREENS[index % GREENS.length]));
  foliage.scale.set(s * 0.95, s * 1.5, s * 0.95);
  foliage.position.y = 0.35 * s;
  return new THREE.Group().add(trunk, foliage);
}

/** Pond with a ring of pebbles. */
function makePond(d: Decor) {
  const g = new THREE.Group();
  const water = new THREE.Mesh(new THREE.CircleGeometry(d.size, 48), glaze('#8fbfd6', { roughness: 0.05 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.012;
  g.add(water);
  const stones = Math.round(16 * (d.size / 1.3));
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), glaze(i % 3 ? '#efe5d0' : '#dcc8a6'));
    stone.scale.y = 0.5;
    stone.position.set(Math.cos(a) * (d.size + 0.12), 0.03, Math.sin(a) * (d.size + 0.12));
    g.add(stone);
  }
  return g;
}

function makeRock(d: Decor) {
  const rock = new THREE.Mesh(new THREE.SphereGeometry(d.size, 20, 14), glaze('#d8d2c4', { roughness: 0.5 }));
  rock.scale.set(1, 0.55, 0.85);
  rock.position.y = d.size * 0.2;
  return new THREE.Group().add(rock);
}

function makeMushroom(d: Decor) {
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 10), glaze('#f6efe2'));
  stem.position.y = 0.06;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glaze('#ec8a6a'));
  cap.scale.y = 0.8;
  cap.position.y = 0.11;
  const g = new THREE.Group().add(stem, cap);
  g.scale.setScalar(d.size);
  return g;
}

const WELL: Pt[] = [[0, 0], [0.4, 0], [0.52, 0.04], [0.6, 0.22], [0.62, 0.4], [0.56, 0.46], [0.5, 0.42], [0.47, 0.34], [0, 0.34]];

/** Glaze well (Studio Mode): a cream basin, its water the colour it last made. */
function makeWell(d: Decor, tint = '#9fd0ee') {
  const basin = new THREE.Mesh(latheFrom(WELL).geo, glaze('#efe5d0'));
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.47, 40), glaze(tint, { roughness: 0.05 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.36;
  const g = new THREE.Group().add(basin, water);
  g.scale.setScalar(d.size);
  return g;
}

const BOWL: Pt[] = [[0, 0], [0.22, 0], [0.3, 0.03], [0.46, 0.14], [0.56, 0.3], [0.58, 0.34], [0.54, 0.35], [0.43, 0.2], [0.28, 0.1], [0, 0.09]];

/**
 * Mixing bowl (Studio Mode): a wide, shallow cream bowl. Its paint is two halves (children 1 and 2)
 * that the Studio colours and turns while it stirs; hidden while the bowl is empty.
 */
function makeBowl(d: Decor) {
  const bowl = new THREE.Mesh(latheFrom(BOWL).geo, glaze('#f7f4ee'));
  const halves = [0, Math.PI].map((start) => {
    const half = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32, start, Math.PI), glaze('#ffffff', { roughness: 0.05 }));
    half.rotation.x = -Math.PI / 2;
    half.position.y = 0.2;
    half.visible = false;
    return half;
  });
  const g = new THREE.Group().add(bowl, ...halves);
  g.scale.setScalar(d.size);
  return g;
}

/** A scallop shell lying on the grass: a fan of ribs in a pale blush glaze, hinged at the back. */
function makeShell(d: Decor) {
  const g = new THREE.Group();
  const mat = glaze('#f3d5c8', { roughness: 0.4 });
  const ribs = 9;
  for (let i = 0; i < ribs; i++) {
    const a = -1.05 + (i / (ribs - 1)) * 2.1; // spread of the fan
    const rib = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), mat);
    rib.rotation.set(Math.PI / 2 - 0.25, 0, -a);
    rib.position.set(Math.sin(a) * 0.12, 0.045, -0.06 + Math.cos(a) * 0.12);
    g.add(rib);
  }
  const hinge = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), glaze('#e8bfae', { roughness: 0.4 }));
  hinge.scale.set(1.4, 0.7, 0.8);
  hinge.position.set(0, 0.03, -0.07);
  g.add(hinge);
  g.scale.setScalar(d.size * 1.5);
  return g;
}

/** A pebble of sea glass: frosted, sea-green, worn smooth. */
function makeSeaGlass(d: Decor) {
  const pebble = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 20, 14),
    new THREE.MeshPhysicalMaterial({ color: '#9fd8c4', transmission: 0.85, thickness: 0.2, roughness: 0.55, ior: 1.5 }),
  );
  pebble.scale.set(1.25, 0.45, 0.9);
  pebble.position.y = 0.05;
  const g = new THREE.Group().add(pebble);
  g.scale.setScalar(d.size);
  return g;
}

/** Height of a decoration's top, for placing the Remove button above it. */
export function decorHeight(d: Decor) {
  if (d.kind === 'tree') return 1.95 * d.size;
  if (d.kind === 'pond') return 0.3;
  if (d.kind === 'rock') return d.size * 0.8;
  if (d.kind === 'well') return 0.5 * d.size;
  if (d.kind === 'bowl') return 0.4 * d.size;
  if (d.kind === 'shell') return 0.2 * d.size;
  if (d.kind === 'seaglass') return 0.15 * d.size;
  return 0.3 * d.size;
}
