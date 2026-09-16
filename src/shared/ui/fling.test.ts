import { describe, expect, it } from 'vitest';
import {
  FLING_END_VELOCITY,
  FLING_SLOP,
  blendVelocity,
  flingStep,
  swipeIntent,
  throwVelocity,
} from './fling';

describe('swipeIntent', () => {
  it('waits while the press is still inside the slop', () => {
    expect(swipeIntent(0, 0)).toBe('pending');
    expect(swipeIntent(FLING_SLOP - 1, 2)).toBe('pending');
  });

  it('takes sideways travel and gives up vertical travel to the page', () => {
    expect(swipeIntent(20, 4)).toBe('swipe');
    expect(swipeIntent(-20, 4)).toBe('swipe');
    expect(swipeIntent(4, 20)).toBe('release');
    // A diagonal is decided by its dominant axis, never shared.
    expect(swipeIntent(15, 14)).toBe('swipe');
    expect(swipeIntent(14, 15)).toBe('release');
  });
});

describe('blendVelocity', () => {
  it('starts on the first sample rather than crawling up from zero', () => {
    expect(blendVelocity(0, 16, 16)).toBe(1);
  });

  it('keeps some of what came before', () => {
    const v = blendVelocity(1, 0, 16, 0.7);
    expect(v).toBeCloseTo(0.3, 6);
    expect(v).toBeGreaterThan(0);
  });

  it('ignores a sample with no time in it', () => {
    expect(blendVelocity(0.5, 30, 0)).toBe(0.5);
    expect(blendVelocity(0.5, 30, -4)).toBe(0.5);
  });
});

describe('throwVelocity', () => {
  it('throws what the finger was doing', () => {
    expect(throwVelocity({ velocity: 1.2, sinceLastMoveMs: 8 })).toBe(1.2);
    expect(throwVelocity({ velocity: -1.2, sinceLastMoveMs: 8 })).toBe(-1.2);
  });

  it('throws nothing from a finger that had already stopped', () => {
    expect(throwVelocity({ velocity: 1.2, sinceLastMoveMs: 400 })).toBe(0);
  });

  it('throws nothing from a cancelled gesture or a slow drag', () => {
    expect(throwVelocity({ velocity: 1.2, sinceLastMoveMs: 8, cancelled: true })).toBe(0);
    expect(throwVelocity({ velocity: 0.05, sinceLastMoveMs: 8 })).toBe(0);
  });
});

describe('flingStep', () => {
  it('travels at the speed it was given and slows down', () => {
    const step = flingStep(1, 16);
    expect(step.dx).toBe(16);
    expect(step.velocity).toBeCloseTo(0.93, 6);
    expect(step.done).toBe(false);
  });

  it('keeps the direction it was thrown in', () => {
    expect(flingStep(-1, 16).dx).toBe(-16);
    expect(flingStep(-1, 16).velocity).toBeLessThan(0);
  });

  it('ends once the speed is spent', () => {
    expect(flingStep(FLING_END_VELOCITY / 2, 16).done).toBe(true);
  });

  it('comes to a stop in about a second, and travels a bounded distance', () => {
    let v = 2;
    let travelled = 0;
    let frames = 0;
    while (frames < 600) {
      const step = flingStep(v, 16);
      travelled += step.dx;
      v = step.velocity;
      frames += 1;
      if (step.done) break;
    }
    expect(frames).toBeLessThan(80);
    expect(travelled).toBeGreaterThan(300);
    expect(travelled).toBeLessThan(600);
  });

  it('clamps a frame a backgrounded tab left behind', () => {
    // Five seconds away must not teleport the band across the trip.
    expect(Math.abs(flingStep(1, 5000).dx)).toBeLessThanOrEqual(64);
    expect(flingStep(1, 5000).done).toBe(true);
  });
});
