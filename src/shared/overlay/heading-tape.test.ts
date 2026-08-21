import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  tapeFadeAlpha,
  tapeTicks,
  tickLabel,
  wrap360,
} from './heading-tape';

describe('wrap360 / angleDelta', () => {
  it('wraps any angle into [0, 360)', () => {
    expect(wrap360(0)).toBe(0);
    expect(wrap360(360)).toBe(0);
    expect(wrap360(-10)).toBe(350);
    expect(wrap360(730)).toBe(10);
  });

  it('takes the short way round North', () => {
    expect(angleDelta(10, 350)).toBe(20);
    expect(angleDelta(350, 10)).toBe(-20);
    expect(angleDelta(0, 0)).toBe(0);
    expect(Math.abs(angleDelta(180, 0))).toBe(180);
  });
});

describe('tickLabel', () => {
  it('names the cardinals and numbers the rest', () => {
    expect(tickLabel(0, true)).toBe('N');
    expect(tickLabel(90, true)).toBe('E');
    expect(tickLabel(180, true)).toBe('S');
    expect(tickLabel(270, true)).toBe('W');
    expect(tickLabel(30, true)).toBe('30');
    expect(tickLabel(360, true)).toBe('N'); // wraps first
  });

  it('numbers the cardinals too when letters are off', () => {
    expect(tickLabel(90, false)).toBe('90');
  });
});

describe('tapeTicks', () => {
  it('centres the heading and stays inside the window', () => {
    const ticks = tapeTicks(90, 90, 30, 10, true);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tk of ticks) {
      expect(tk.t).toBeGreaterThanOrEqual(-1);
      expect(tk.t).toBeLessThanOrEqual(1);
    }
    // 90° is a multiple of both steps, so a labelled tick sits under the sight.
    const centre = ticks.find((tk) => Math.abs(tk.t) < 1e-9);
    expect(centre?.deg).toBe(90);
    expect(centre?.label).toBe('E');
  });

  it('slides rather than snapping: an off-step heading offsets every tick', () => {
    const ticks = tapeTicks(95, 90, 30, 10, true);
    expect(ticks.some((tk) => Math.abs(tk.t) < 1e-9)).toBe(false);
    const ninety = ticks.find((tk) => tk.deg === 90)!;
    // 90 is 5° to the left of a 45° half-window.
    expect(ninety.t).toBeCloseTo(-5 / 45, 6);
  });

  it('crosses North without a gap', () => {
    const ticks = tapeTicks(350, 90, 30, 10, true);
    const degs = ticks.map((tk) => tk.deg);
    expect(degs).toContain(350);
    expect(degs).toContain(0);
    expect(degs).toContain(30);
    // Monotonic left to right, North included.
    const ts = ticks.map((tk) => tk.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(ticks.find((tk) => tk.deg === 0)?.label).toBe('N');
  });

  it('marks majors and leaves minors unlabelled', () => {
    const ticks = tapeTicks(0, 120, 30, 10, true);
    const majors = ticks.filter((tk) => tk.major);
    expect(majors.every((tk) => tk.label !== null)).toBe(true);
    expect(ticks.filter((tk) => !tk.major).every((tk) => tk.label === null)).toBe(true);
    expect(majors.map((tk) => tk.deg)).toEqual([300, 330, 0, 30, 60]);
  });

  it('widens with the span', () => {
    const narrow = tapeTicks(180, 40, 30, 10, true).length;
    const wide = tapeTicks(180, 180, 30, 10, true).length;
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('tapeFadeAlpha', () => {
  it('is opaque in the middle and gone at the edges', () => {
    expect(tapeFadeAlpha(0, 0.2)).toBe(1);
    expect(tapeFadeAlpha(1, 0.2)).toBe(0);
    expect(tapeFadeAlpha(-1, 0.2)).toBe(0);
    expect(tapeFadeAlpha(0.9, 0.2)).toBeCloseTo(0.5, 6);
    expect(tapeFadeAlpha(-0.9, 0.2)).toBeCloseTo(0.5, 6);
  });

  it('never fades when the fade is off', () => {
    expect(tapeFadeAlpha(1, 0)).toBe(1);
    expect(tapeFadeAlpha(-1, 0)).toBe(1);
  });
});
