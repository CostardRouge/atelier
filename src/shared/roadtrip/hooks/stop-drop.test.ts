import { describe, expect, it } from 'vitest';
import { dropLine, hopAt, insertAtHop, resolveDrop, swapAt } from './stop-drop';

// Five stops along a horizontal line, 100 px apart.
const ROW = [0, 100, 200, 300, 400].map((x) => ({ x, y: 0 }));
const NAMES = ['A', 'B', 'C', 'D', 'E'];
const name = (i: number) => NAMES[i] ?? '';

describe('where a dropped stop lands', () => {
  it('swaps with the stop it is dropped on', () => {
    expect(resolveDrop(ROW, 4, { x: 104, y: 6 })).toEqual({ kind: 'swap', index: 1 });
  });

  it('is inserted when dropped on a line between two other stops', () => {
    expect(resolveDrop(ROW, 4, { x: 150, y: 7 })).toEqual({ kind: 'insert', hop: 1 });
  });

  it('moves when dropped off every line and every stop', () => {
    expect(resolveDrop(ROW, 4, { x: 150, y: 60 })).toEqual({ kind: 'move' });
  });

  it('never takes its own two lines, nor itself, as a target', () => {
    // On the hop C–D, which D (index 3) ends: a move, not an insertion.
    expect(resolveDrop(ROW, 3, { x: 250, y: 4 })).toEqual({ kind: 'move' });
    expect(resolveDrop(ROW, 3, { x: 300, y: 2 })).toEqual({ kind: 'move' });
  });

  it('lets a stop win over the line it ends', () => {
    expect(resolveDrop(ROW, 0, { x: 196, y: 3 })).toEqual({ kind: 'swap', index: 2 });
  });

  it('reads a bowed hop by its drawn path', () => {
    const paths = ROW.slice(1).map((b, i) => [ROW[i], { x: (ROW[i].x + b.x) / 2, y: 40 }, b]);
    expect(hopAt(ROW, { x: 150, y: 40 }, { paths })).toBe(1);
    expect(hopAt(ROW, { x: 150, y: 40 })).toBeNull();
  });
});

describe('the edits a drop makes', () => {
  it('swaps two stops and nothing else', () => {
    expect(swapAt(NAMES, 4, 1)).toEqual(['A', 'E', 'C', 'D', 'B']);
    expect(swapAt(NAMES, 4, 9)).toEqual(NAMES);
  });

  it('inserts a later stop between two earlier ones', () => {
    expect(insertAtHop(NAMES, 4, 1)).toEqual(['A', 'B', 'E', 'C', 'D']);
  });

  it('inserts an earlier stop between two later ones', () => {
    expect(insertAtHop(NAMES, 0, 2)).toEqual(['B', 'C', 'A', 'D', 'E']);
  });

  it('leaves the list alone next to the stop itself', () => {
    expect(insertAtHop(NAMES, 2, 1)).toEqual(NAMES);
    expect(insertAtHop(NAMES, 2, 2)).toEqual(NAMES);
  });

  it('says what letting go will do, with the number the stop will take', () => {
    expect(dropLine({ kind: 'insert', hop: 1 }, name, 4)).toBe('Let go to make E number 3, between 2 and 3');
    expect(dropLine({ kind: 'insert', hop: 2 }, name, 0)).toBe('Let go to make A number 3, between 3 and 4');
    expect(dropLine({ kind: 'swap', index: 1 }, name, 4)).toBe('Let go to swap E with 2 B');
    expect(dropLine({ kind: 'move' }, name, 4)).toBe('Let go to move E here');
  });
});
