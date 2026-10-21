import { describe, expect, test } from 'vitest';
import { canDye, dye, putAway, takeOut } from '../src/studio/storage';
import { newStudio, PRIMARIES, type StudioState } from '../src/studio/state';
import { normaliseLayout } from '../src/scene/layout';

const { red, cobalt } = PRIMARIES;
const studio = (): StudioState => ({
  ...newStudio(0),
  purse: { clay: 0, paint: { [red]: 2 } },
  island: { radius: 6, items: [{ id: 't', kind: 'tree', x: 1, z: 1, size: 1, rot: 0 }, { id: 'p', kind: 'pond', x: -2, z: -2, size: 1, rot: 0 }] },
});

describe('dyeing decorations', () => {
  test('dyeing takes 1 paint of that colour', () => {
    const s = dye(studio(), 't', red)!;
    expect(s.island.items.find((d) => d.id === 't')!.colour).toBe(red);
    expect(s.purse.paint[red]).toBe(1);
  });

  test('not without the paint, not twice the same colour, not ponds or the harbour', () => {
    expect(dye(studio(), 't', cobalt)).toBeNull();
    expect(dye(dye(studio(), 't', red)!, 't', red)).toBeNull();
    expect(dye(studio(), 'p', red)).toBeNull();
    expect(canDye('harbour')).toBe(false);
    expect(canDye('well')).toBe(true);
  });

  test('back to white is free, and re-dyeing costs paint again', () => {
    const red1 = dye(studio(), 't', red)!;
    const white = dye(red1, 't', null)!;
    expect(white.island.items.find((d) => d.id === 't')!.colour).toBeUndefined();
    expect(white.purse.paint[red]).toBe(1);
    expect(dye(white, 't', null)).toBeNull(); // white already
    expect(dye(white, 't', red)!.purse.paint[red]).toBe(0);
  });

  test('the colour stays through storage', () => {
    const s = putAway(dye(studio(), 't', red)!, 't')!;
    expect(s.storage[0].colour).toBe(red);
    expect(takeOut(s, 'tree')!.item.colour).toBe(red);
  });

  test('island saves keep colours, and drop broken ones', () => {
    const layout = normaliseLayout({ radius: 6, items: [{ id: 'a', kind: 'tree', x: 0, z: 0, size: 1, colour: '#D8382F' }, { id: 'b', kind: 'rock', x: 2, z: 0, size: 0.4, colour: 'red' }] });
    expect(layout.items[0].colour).toBe('#d8382f');
    expect(layout.items[1].colour).toBeUndefined();
  });
});
