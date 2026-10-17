import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { route, type World } from '../src/plaza/behaviour';

const v = (x: number, z: number) => new THREE.Vector2(x, z);
/** The closest the walk from `from` along `path` comes to an obstacle's edge. */
function closest(world: World, from: THREE.Vector2, path: THREE.Vector2[]) {
  let best = Infinity;
  let p = from;
  for (const q of path) {
    for (let i = 0; i <= 50; i++) {
      const x = p.x + ((q.x - p.x) * i) / 50;
      const z = p.y + ((q.y - p.y) * i) / 50;
      for (const o of world.obstacles) best = Math.min(best, Math.hypot(x - o.x, z - o.z) - o.r);
    }
    p = q;
  }
  return best;
}

describe('walking round things', () => {
  test('straight there when nothing is in the way', () => {
    const world: World = { radius: 7, obstacles: [{ x: 0, z: 4, r: 1 }] };
    expect(route(world, v(-3, 0), v(3, 0), 0.3)).toEqual([v(3, 0)]);
  });

  test('round an obstacle in the way, never through it', () => {
    const world: World = { radius: 7, obstacles: [{ x: 0, z: 0, r: 1.2 }] };
    const path = route(world, v(-4, 0), v(4, 0), 0.3)!;
    expect(path.length).toBeGreaterThan(1);
    expect(path.at(-1)).toEqual(v(4, 0));
    expect(closest(world, v(-4, 0), path)).toBeGreaterThanOrEqual(0.3 - 1e-6);
  });

  test('through a gap between several obstacles', () => {
    const world: World = { radius: 7, obstacles: [{ x: 0, z: 1.6, r: 1 }, { x: 0, z: -1.6, r: 1 }, { x: 0, z: 4.2, r: 1.2 }] };
    const path = route(world, v(-4, 0), v(4, 0), 0.25)!;
    expect(closest(world, v(-4, 0), path)).toBeGreaterThanOrEqual(0.25 - 1e-6);
  });

  test('no way to a spot walled in on every side', () => {
    const ring = Array.from({ length: 12 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 6) * 2, z: Math.sin((i * Math.PI) / 6) * 2, r: 0.7 }));
    expect(route({ radius: 7, obstacles: ring }, v(-5, 0), v(0, 0), 0.3)).toBeNull();
  });
});
