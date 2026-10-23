import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { buyHouse, HOME_COMFORT, homeOf, houseCost, housesUnlocked, moveIn, moveOut, residentOf } from '../src/studio/houses';
import { comfortHere } from '../src/studio/happiness';
import { sayGoodbye } from '../src/studio/residents';
import { putAway } from '../src/studio/storage';
import { bareGhost, newStudio, normaliseStudio, studioData, type StudioState } from '../src/studio/state';
import { doorOf, footprint, obstaclesFor } from '../src/scene/layout';
import { route } from '../src/plaza/behaviour';

function studio(clay = 1000): StudioState {
  const s = newStudio(0);
  return {
    ...s,
    wellsBuilt: 1,
    characters: ['a', 'b'].map((id) => bareGhost({ id, name: id.toUpperCase() })),
    purse: { clay, paint: {} },
    island: { radius: 6, items: [] },
  };
}
const build = (s: StudioState) => buyHouse(s)!;

describe('building houses', () => {
  test('once there is a glaze well, 120 clay for the first and more for each after', () => {
    expect(housesUnlocked({ ...studio(), wellsBuilt: 0 })).toBe(false);
    expect(buyHouse({ ...studio(), wellsBuilt: 0 })).toBeNull();
    let s = studio();
    expect(houseCost(s)).toBe(120);
    s = build(s).state;
    expect(s.purse.clay).toBe(1000 - 120);
    expect(houseCost(s)).toBe(180);
    s = build(s).state;
    expect(houseCost(s)).toBe(270);
    expect(s.island.items.filter((d) => d.kind === 'house')).toHaveLength(2);
    expect(buyHouse({ ...s, purse: { clay: 269, paint: {} } })).toBeNull();
  });

  test('a house put away still counts towards the price', () => {
    const { state, house } = build(studio());
    expect(houseCost(putAway(state, house.id)!)).toBe(180);
  });
});

describe('homes', () => {
  test('one resident each, one house each: moving in elsewhere leaves the old house empty', () => {
    let s = studio();
    const one = build(s);
    const two = build(one.state);
    s = moveIn(two.state, one.house.id, 'a')!;
    expect(residentOf(s, one.house.id)).toBe('a');
    expect(homeOf(s, 'a')?.id).toBe(one.house.id);
    s = moveIn(s, two.house.id, 'a')!;
    expect(residentOf(s, one.house.id)).toBeNull();
    expect(homeOf(s, 'a')?.id).toBe(two.house.id);
    s = moveIn(s, two.house.id, 'b')!; // someone new moves in: the last one moves out
    expect(homeOf(s, 'a')).toBeNull();
    expect(moveIn(s, two.house.id, 'b')).toBeNull(); // already theirs
    expect(moveIn(s, 'nope', 'b')).toBeNull();
    expect(moveIn(s, two.house.id, 'nobody')).toBeNull();
    s = moveOut(s, two.house.id)!;
    expect(s.homes).toEqual({});
    expect(moveOut(s, two.house.id)).toBeNull();
  });

  test('a house put away is not a home just now, but they move back in when it comes out', () => {
    const { state, house } = build(studio());
    const lived = moveIn(state, house.id, 'a')!;
    const away = putAway(lived, house.id)!;
    expect(homeOf(away, 'a')).toBeNull();
    expect(away.homes).toEqual({ [house.id]: 'a' });
  });

  test('a home makes them more comfortable, wherever they are', () => {
    const island = { radius: 6, items: [] };
    expect(comfortHere(island, { x: 0, z: 0 }, 2, HOME_COMFORT) - comfortHere(island, { x: 0, z: 0 }, 2)).toBeCloseTo(HOME_COMFORT);
  });

  test('saying goodbye leaves their house empty; a reload drops homes that no longer make sense', () => {
    const { state, house } = build(studio());
    const lived = moveIn(state, house.id, 'a')!;
    expect(sayGoodbye(lived, 'a')!.homes).toEqual({});
    const messy = { ...studioData(lived), homes: { [house.id]: 'a', ghost: 'b', [`${house.id}x`]: 'b' } };
    expect(normaliseStudio(messy).homes).toEqual({ [house.id]: 'a' });
    expect(normaliseStudio(JSON.parse(JSON.stringify(studioData(lived)))).homes).toEqual({ [house.id]: 'a' });
  });

  test('the door is clear of the house, so they can walk there from across the island', () => {
    const { state, house } = build(studio());
    for (const rot of [0, 1.3, Math.PI]) {
      const turned = { ...house, rot };
      const door = doorOf(turned);
      expect(Math.hypot(door.x - house.x, door.z - house.z)).toBeGreaterThan(footprint(house) + 0.4);
      const world = { radius: state.island.radius, obstacles: obstaclesFor({ ...state.island, items: [turned] }) };
      expect(route(world, new THREE.Vector2(-4, -3), new THREE.Vector2(door.x, door.z), 0.4)).not.toBeNull();
    }
  });
});
