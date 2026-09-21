import { describe, expect, it } from 'vitest';
import type { DngGainMap } from '../exif/dng-opcodes';
import { gainAt, gainEncoded, gainFieldFrom, isFlatField, maxGain } from './gain-map';

const W = 8064;
const H = 4536;

/** A 2×2 map over the whole frame, corners first, as the file states one. */
function map(gains: number[], over: Partial<DngGainMap> = {}): DngGainMap {
  const mapPlanes = over.mapPlanes ?? 3;
  const rows = over.rows ?? 2;
  const cols = over.cols ?? 2;
  return {
    rect: { top: 0, left: 0, bottom: H, right: W },
    plane: 0,
    planes: 3,
    rows,
    cols,
    originV: 0,
    originH: 0,
    spacingV: 1 / (rows - 1),
    spacingH: 1 / (cols - 1),
    mapPlanes,
    gains: new Float32Array(gains),
    ...over,
  };
}

describe('gainFieldFrom', () => {
  it('lays the file’s own nodes over the image, and keeps its numbers exactly', () => {
    // top-left 5.93/5.06/4.97, the other three 1.
    const f = gainFieldFrom([map([5.93, 5.06, 4.97, 1, 1, 1, 1, 1, 1, 1, 1, 1])], W, H)!;
    expect(f.cols).toBe(2);
    expect(f.rows).toBe(2);
    expect(f.originU).toBe(0);
    expect(f.originV).toBe(0);
    expect(f.stepU).toBeCloseTo(1, 10);
    expect(f.stepV).toBeCloseTo(1, 10);
    expect(Array.from(f.gains.slice(0, 3)).map((g) => +g.toFixed(2))).toEqual([5.93, 5.06, 4.97]);
    // The corner the file asks 5.93× for really answers 5.93×.
    expect(gainAt(f, 0, 0)[0]).toBeCloseTo(5.93, 5);
    expect(gainAt(f, 1, 1)[0]).toBeCloseTo(1, 5);
  });

  it('interpolates between the nodes, and holds at the edge outside them', () => {
    const f = gainFieldFrom([map([3, 3, 3, 1, 1, 1, 3, 3, 3, 1, 1, 1])], W, H)!;
    expect(gainAt(f, 0.5, 0)[0]).toBeCloseTo(2, 5);
    expect(gainAt(f, 0.25, 0.5)[1]).toBeCloseTo(2.5, 5);
    // Past the grid, the edge node — never an extrapolation.
    expect(gainAt(f, -0.4, 0.5)[0]).toBeCloseTo(3, 5);
    expect(gainAt(f, 1.7, 0.5)[0]).toBeCloseTo(1, 5);
  });

  it('shares ONE grid plane across the three colours when the file writes one', () => {
    const f = gainFieldFrom([map([4, 1, 4, 1], { mapPlanes: 1 })], W, H)!;
    const [r, g, b] = gainAt(f, 0, 0);
    expect([r, g, b]).toEqual([4, 4, 4]);
  });

  it('honours a rectangle that is not the whole frame', () => {
    const half = map([2, 2, 2, 1, 1, 1, 2, 2, 2, 1, 1, 1], {
      rect: { top: 0, left: W / 2, bottom: H, right: W },
    });
    const f = gainFieldFrom([half], W, H)!;
    expect(f.originU).toBeCloseTo(0.5, 10);
    expect(f.stepU).toBeCloseTo(0.5, 10);
    // Inside the rectangle the numbers are the file's; left of it, held.
    expect(gainAt(f, 0.5, 0)[0]).toBeCloseTo(2, 5);
    expect(gainAt(f, 0.75, 0)[0]).toBeCloseTo(1.5, 5);
    expect(gainAt(f, 0.1, 0)[0]).toBeCloseTo(2, 5);
  });

  it('refuses nonsense rather than building a field that lies', () => {
    expect(gainFieldFrom([], W, H)).toBeNull();
    expect(gainFieldFrom([map([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])], 0, H)).toBeNull();
    expect(gainFieldFrom([map([1], { rows: 1, cols: 1, spacingH: 0, spacingV: 0 })], W, H)).toBeNull();
  });
});

describe('gainEncoded', () => {
  it('multiplies LIGHT, not code — mid grey doubled is not twice its code', () => {
    // 0.5 encoded is 0.2140 linear; ×2 is 0.4280, which encodes to 0.6858 —
    // not 1.0, which is what multiplying the code would have given.
    expect(gainEncoded(0.5, 2)).toBeCloseTo(0.6858, 4);
    expect(gainEncoded(0.5, 1)).toBe(0.5);
    // Black stays black whatever the gain, which is what makes a lift on the
    // corner a lift and not a fog.
    expect(gainEncoded(0, 5.93)).toBeCloseTo(0, 6);
  });
});

describe('maxGain and isFlatField', () => {
  it('says what the file asks for at its strongest', () => {
    const f = gainFieldFrom([map([5.93, 5.06, 4.97, 1, 1, 1, 1, 1, 1, 1, 1, 1])], W, H)!;
    expect(maxGain(f)).toBeCloseTo(5.93, 5);
    expect(isFlatField(f)).toBe(false);
    expect(maxGain(null)).toBe(1);
  });

  it('knows a field that would multiply nothing, so no pass is built for it', () => {
    const flat = gainFieldFrom([map(new Array(12).fill(1))], W, H)!;
    expect(isFlatField(flat)).toBe(true);
    expect(isFlatField(null)).toBe(true);
  });
});
