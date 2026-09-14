import { describe, expect, it } from 'vitest';
import { LONG_PRESS_MS, PRESS_SLOP, pressIntent } from './press-intent';

describe('pressIntent', () => {
  it('stays undecided while a press is short and still', () => {
    expect(pressIntent({ pointerType: 'mouse', dx: 2, dy: 1, heldMs: 100 })).toBe('pending');
    expect(pressIntent({ pointerType: 'touch', dx: 0, dy: PRESS_SLOP, heldMs: LONG_PRESS_MS - 1 })).toBe('pending');
  });
  it('lets a mouse or a pen drag by travelling past the slop', () => {
    expect(pressIntent({ pointerType: 'mouse', dx: PRESS_SLOP + 1, dy: 0, heldMs: 20 })).toBe('drag');
    expect(pressIntent({ pointerType: 'pen', dx: 0, dy: -10, heldMs: 20 })).toBe('drag');
  });
  it('lets go of a finger that travels before the hold, so the page scrolls', () => {
    expect(pressIntent({ pointerType: 'touch', dx: 20, dy: 0, heldMs: 100 })).toBe('release');
  });
  it('makes a still hold a drag for a finger only — a slow click stays a click', () => {
    expect(pressIntent({ pointerType: 'touch', dx: 1, dy: 2, heldMs: LONG_PRESS_MS })).toBe('drag');
    expect(pressIntent({ pointerType: 'mouse', dx: 0, dy: 0, heldMs: 900 })).toBe('pending');
  });
});
