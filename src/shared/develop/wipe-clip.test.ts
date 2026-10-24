import { describe, expect, it } from 'vitest';
import { beforeClip } from './wipe-clip';

describe('beforeClip', () => {
  it('shows nothing without a split or before anything is measured', () => {
    expect(beforeClip(0, { w: 300, h: 200 }, { width: 300, height: 200 })).toBeNull();
    expect(beforeClip(0.5, null, { width: 300, height: 200 })).toBeNull();
    expect(beforeClip(0.5, { w: 300, h: 200 }, { width: 0, height: 0 })).toBeNull();
  });

  it('cuts at the divider when the canvas fills its box', () => {
    expect(beforeClip(0.25, { w: 400, h: 200 }, { width: 800, height: 400 })).toBe('inset(0 600px 0 0)');
  });

  it('reads the divider across the letterboxed picture, not the box', () => {
    // A 3:2 canvas in a square box: drawn 600 wide, 0 from the left; in a
    // wide box it is drawn 300 wide from x = 250.
    expect(beforeClip(0.5, { w: 300, h: 200 }, { width: 600, height: 600 })).toBe('inset(0 300px 0 0)');
    expect(beforeClip(0.5, { w: 300, h: 200 }, { width: 800, height: 200 })).toBe('inset(0 400px 0 0)');
    expect(beforeClip(0.1, { w: 300, h: 200 }, { width: 800, height: 200 })).toBe('inset(0 520px 0 0)');
  });

  it('stops at the picture’s right edge with the divider all the way across', () => {
    expect(beforeClip(1, { w: 300, h: 200 }, { width: 800, height: 200 })).toBe('inset(0 250px 0 0)');
    expect(beforeClip(1.5, { w: 300, h: 200 }, { width: 800, height: 200 })).toBe('inset(0 250px 0 0)');
  });
});
