import { describe, expect, it } from 'vitest';
import {
  easeAt,
  isHidden,
  isIdentity,
  phasesFor,
  transformAt,
  type AnimStep,
  type ElementAnimation,
} from './animation';

const fadeIn: AnimStep = { preset: 'fade', duration: 1, easing: 'linear' };
const fadeOut: AnimStep = { preset: 'fade', duration: 1, easing: 'linear' };

describe('easeAt', () => {
  it('pins both ends whatever the curve', () => {
    for (const e of ['linear', 'in', 'out', 'in-out'] as const) {
      expect(easeAt(e, 0)).toBe(0);
      expect(easeAt(e, 1)).toBe(1);
    }
  });

  it('clamps outside 0..1', () => {
    expect(easeAt('out', -2)).toBe(0);
    expect(easeAt('out', 5)).toBe(1);
  });

  it("decelerates on 'out' and accelerates on 'in'", () => {
    expect(easeAt('out', 0.5)).toBeGreaterThan(0.5);
    expect(easeAt('in', 0.5)).toBeLessThan(0.5);
  });
});

describe('transformAt', () => {
  const anim: ElementAnimation = { in: fadeIn, out: fadeOut };
  const win = { start: 1, end: 5 };

  it('draws nothing before the window opens or after it closes', () => {
    expect(isHidden(transformAt(anim, win, 0.9))).toBe(true);
    expect(isHidden(transformAt(anim, win, 5))).toBe(true);
    expect(isHidden(transformAt(anim, win, 9))).toBe(true);
  });

  it('fades in from the window start', () => {
    expect(transformAt(anim, win, 1).alpha).toBeCloseTo(0);
    expect(transformAt(anim, win, 1.5).alpha).toBeCloseTo(0.5);
    expect(isIdentity(transformAt(anim, win, 2.5))).toBe(true);
  });

  it('finishes the exit exactly at the window end', () => {
    expect(transformAt(anim, win, 4).alpha).toBeCloseTo(1);
    expect(transformAt(anim, win, 4.5).alpha).toBeCloseTo(0.5);
    expect(transformAt(anim, win, 4.99).alpha).toBeLessThan(0.02);
  });

  it('holds an element invisible through its stagger delay', () => {
    const staggered: ElementAnimation = { in: { ...fadeIn, delay: 2 } };
    expect(isHidden(transformAt(staggered, win, 2.5))).toBe(true);
    expect(transformAt(staggered, win, 3.5).alpha).toBeCloseTo(0.5);
  });

  it('is the identity with neither window nor animation', () => {
    expect(isIdentity(transformAt(null, null, 12))).toBe(true);
  });

  it('plays an animation with no window from the first frame', () => {
    expect(transformAt({ in: fadeIn }, null, 0.5).alpha).toBeCloseTo(0.5);
    expect(isIdentity(transformAt({ in: fadeIn }, null, 30))).toBe(true);
  });

  it('cuts hard without an animation, inside the window only', () => {
    expect(isHidden(transformAt(null, win, 0.5))).toBe(true);
    expect(isIdentity(transformAt(null, win, 3))).toBe(true);
    expect(isHidden(transformAt(null, win, 6))).toBe(true);
  });

  it('never leaves without an end to leave at', () => {
    const open = { start: 0, end: null };
    expect(isIdentity(transformAt(anim, open, 1000))).toBe(true);
  });
});

describe('slide and scale', () => {
  it('enters from below when it travels up, and leaves upwards', () => {
    const win = { start: 0, end: 4 };
    const anim: ElementAnimation = {
      in: { preset: 'slide', duration: 1, easing: 'linear', direction: 'up' },
      out: { preset: 'slide', duration: 1, easing: 'linear', direction: 'up' },
    };
    expect(transformAt(anim, win, 0).dy).toBeGreaterThan(0); // starts below
    expect(transformAt(anim, win, 3.99).dy).toBeLessThan(0); // ends above
    expect(transformAt(anim, win, 2).dy).toBe(0);
  });

  it('mirrors the axis for a horizontal slide', () => {
    const t = transformAt(
      { in: { preset: 'slide', duration: 1, easing: 'linear', direction: 'left' } },
      { start: 0, end: null },
      0,
    );
    expect(t.dx).toBeGreaterThan(0);
    expect(t.dy).toBe(0);
  });

  it('grows from scaleFrom to 1', () => {
    const anim: ElementAnimation = {
      in: { preset: 'scale', duration: 1, easing: 'linear', scaleFrom: 0.5 },
    };
    expect(transformAt(anim, { start: 0, end: null }, 0).scale).toBeCloseTo(0.5);
    expect(transformAt(anim, { start: 0, end: null }, 0.5).scale).toBeCloseTo(0.75);
    expect(transformAt(anim, { start: 0, end: null }, 1).scale).toBeCloseTo(1);
  });

  it('reveals rather than fades on a typewriter', () => {
    const anim: ElementAnimation = {
      in: { preset: 'typewriter', duration: 1, easing: 'linear' },
    };
    const t = transformAt(anim, { start: 0, end: null }, 0.5);
    expect(t.reveal).toBeCloseTo(0.5);
    expect(t.alpha).toBe(1);
  });
});

describe('overshoot and steps', () => {
  const open = { start: 0, end: null };

  it('lets a scale overshoot its rest on back, and clamps the fade', () => {
    const anim: ElementAnimation = {
      in: { preset: 'scale', duration: 1, easing: 'back', scaleFrom: 0.4 },
    };
    let peak = 0;
    for (let i = 0; i <= 40; i++) {
      const t = transformAt(anim, open, i / 40);
      peak = Math.max(peak, t.scale);
      expect(t.alpha).toBeLessThanOrEqual(1);
      expect(t.alpha).toBeGreaterThanOrEqual(0);
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(isIdentity(transformAt(anim, open, 1))).toBe(true);
  });

  it('moves a fade in whole jumps on steps', () => {
    const anim: ElementAnimation = {
      in: { preset: 'fade', duration: 1, easing: 'steps', steps: 4 },
    };
    expect(transformAt(anim, open, 0.1).alpha).toBe(0);
    expect(transformAt(anim, open, 0.3).alpha).toBe(0.25);
    expect(transformAt(anim, open, 0.8).alpha).toBe(0.75);
    expect(isIdentity(transformAt(anim, open, 1))).toBe(true);
  });
});

describe('phasesFor', () => {
  it('lays the exit against the window end', () => {
    const ph = phasesFor({ start: 2, end: 10 }, { in: fadeIn, out: fadeOut });
    expect(ph.inStart).toBe(2);
    expect(ph.inEnd).toBe(3);
    expect(ph.outStart).toBe(9);
  });

  it('splits a window too short to hold both, instead of dropping one', () => {
    const ph = phasesFor({ start: 0, end: 0.4 }, { in: fadeIn, out: fadeOut });
    expect(ph.inEnd).toBeCloseTo(0.2);
    expect(ph.outStart).toBeCloseTo(0.2);
    // Both ends still play: the element appears and leaves.
    const anim: ElementAnimation = { in: fadeIn, out: fadeOut };
    expect(transformAt(anim, { start: 0, end: 0.4 }, 0.1).alpha).toBeGreaterThan(0);
    expect(transformAt(anim, { start: 0, end: 0.4 }, 0.1).alpha).toBeLessThan(1);
  });

  it('has no exit without an end', () => {
    expect(phasesFor({ start: 0, end: null }, { out: fadeOut }).outStart).toBe(Infinity);
  });
});
