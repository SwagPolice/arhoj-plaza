import * as THREE from 'three';
import { canvasTexture, glaze, makeCanvas, speckle } from './stage';
import { latheFrom, type Pt } from '../character/build';
import type { Obstacle, World } from '../plaza/behaviour';
import { mulberry32 } from '../util/random';

export const ISLAND_RADIUS = 7.5;

const TREE: Pt[] = [[0, 0], [0.3, 0], [0.6, 0], [0.62, 0.06], [0.5, 0.3], [0.34, 0.62], [0.18, 0.88], [0.06, 1.02], [0, 1.05]];
const TREES: [number, number, number][] = [[-4.6, -2.6, 1.1], [4.2, -3.6, 1.3], [5.0, 2.2, 0.95], [-0.8, -5.4, 1.15], [1.6, 5.6, 0.9]];
const ROCKS: [number, number, number][] = [[2.6, 3.0, 0.45], [-5.4, 1.0, 0.38], [1.2, -2.6, 0.32]];
const POND = { x: -2.8, z: 2.6, r: 1.3 };

/** A round glazed-ceramic island floating on pale water. */
export function buildIsland(): { group: THREE.Group; world: World } {
  const rand = mulberry32(7);
  const R = ISLAND_RADIUS;
  const group = new THREE.Group();
  const obstacles: Obstacle[] = [];
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

  // Pond with a ring of pebbles
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 48), glaze('#8fbfd6', { roughness: 0.05 }));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, 0.012, POND.z);
  group.add(pond);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), glaze(i % 3 ? '#efe5d0' : '#dcc8a6'));
    stone.scale.y = 0.5;
    stone.position.set(POND.x + Math.cos(a) * (POND.r + 0.12), 0.03, POND.z + Math.sin(a) * (POND.r + 0.12));
    group.add(stone);
  }
  obstacles.push({ x: POND.x, z: POND.z, r: POND.r + 0.3 });

  // Ceramic trees: the same lathe trick as the characters
  const greens = ['#8fb07a', '#a4c08a', '#7fa36f'];
  TREES.forEach(([x, z, s], i) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.45 * s, 12), glaze('#a98462', { roughness: 0.6 }));
    trunk.position.set(x, 0.22 * s, z);
    const foliage = new THREE.Mesh(latheFrom(TREE).geo, glaze(greens[i % greens.length]));
    foliage.scale.set(s * 0.95, s * 1.5, s * 0.95);
    foliage.position.set(x, 0.35 * s, z);
    group.add(trunk, foliage);
    obstacles.push({ x, z, r: 0.7 * s });
  });

  for (const [x, z, s] of ROCKS) {
    const rock = new THREE.Mesh(new THREE.SphereGeometry(s, 20, 14), glaze('#d8d2c4', { roughness: 0.5 }));
    rock.scale.set(1, 0.55, 0.85);
    rock.position.set(x, s * 0.2, z);
    group.add(rock);
    obstacles.push({ x, z, r: s + 0.1 });
  }

  const free = (x: number, z: number) => obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + 0.1);
  const spot = (margin: number) => {
    for (;;) {
      const r = (R - margin) * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (free(x, z)) return [x, z] as const;
    }
  };

  // Little decorations (characters can walk through these)
  const flowerColours = ['#f2b8ae', '#e2b23f', '#fffaf2', '#a7cbe3'];
  for (let i = 0; i < 40; i++) {
    const [x, z] = spot(0.6);
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glaze(flowerColours[i % flowerColours.length]));
    flower.position.set(x, 0.04, z);
    group.add(flower);
  }
  for (let i = 0; i < 6; i++) {
    const [x, z] = spot(1);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 10), glaze('#f6efe2'));
    stem.position.set(x, 0.06, z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glaze('#ec8a6a'));
    cap.scale.y = 0.8;
    cap.position.set(x, 0.11, z);
    group.add(stem, cap);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });

  const water = new THREE.Mesh(new THREE.CircleGeometry(90, 64), glaze('#cfe0dc', { roughness: 0.15, clearcoat: 0.6 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.1;
  water.receiveShadow = true;
  group.add(water);

  return { group, world: { radius: R, obstacles } };
}
