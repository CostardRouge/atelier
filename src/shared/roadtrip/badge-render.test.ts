import { describe, expect, it } from 'vitest';
import {
  frameSize,
} from './badge-render';

describe('frameSize', () => {
  it('puts the long edge on the height for a portrait frame', () => {
    expect(frameSize(9 / 16, 1920)).toEqual({ w: 1080, h: 1920 });
  });

  it('puts it on the width for a landscape frame', () => {
    expect(frameSize(16 / 9, 1920)).toEqual({ w: 1920, h: 1080 });
  });

  it('is square for a square aspect', () => {
    expect(frameSize(1, 1080)).toEqual({ w: 1080, h: 1080 });
  });

  it('returns whole pixels — a canvas cannot be fractional', () => {
    const { w, h } = frameSize(4 / 5, 1000);
    expect(Number.isInteger(w)).toBe(true);
    expect(Number.isInteger(h)).toBe(true);
    expect(w).toBe(800);
  });

  it('never collapses to zero', () => {
    const { w, h } = frameSize(0.001, 10);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});

