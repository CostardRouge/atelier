import { describe, expect, it } from 'vitest';
import type { DngWarp } from '../exif/dng-opcodes';
import { lensSampleRadius } from './lens';
import {
  describeWarp,
  planeOf,
  warpNormRadius,
  warpRatio,
  warpSourcePoint,
  warpSourceUv,
} from './camera-warp';

const W = 8064;
const H = 4536;

const plane = (k0: number, k1 = 0, k2 = 0, k3 = 0, t0 = 0, t1 = 0) => ({
  radial: [k0, k1, k2, k3] as [number, number, number, number],
  tangential: [t0, t1] as [number, number],
});

/** The DJI's own: a 4.93 % magnification, red and blue a hair apart. */
const dji: DngWarp = {
  planes: [plane(1.0495), plane(1.0493), plane(1.0491)],
  centerH: 0.5,
  centerV: 0.5,
};

describe('warpRatio is lensSampleRadius’ own polynomial', () => {
  it('agrees with lensSampleRadius wherever the sliders can reach', () => {
    for (const [k1, k2] of [
      [0, 0],
      [-0.18, -0.06],
      [0.1, 0.02],
    ]) {
      for (let r = 0; r <= 1.0001; r += 0.05) {
        expect(r * warpRatio(r, [1, k1, k2, 0])).toBeCloseTo(lensSampleRadius(r, k1, k2), 12);
      }
    }
  });

  it('adds the two terms the sliders do not offer — a magnification and r⁶', () => {
    expect(warpRatio(1, [1.05, 0, 0, 0])).toBeCloseTo(1.05, 12);
    expect(warpRatio(1, [1, 0, 0, 0.2])).toBeCloseTo(1.2, 12);
    expect(warpRatio(0, [1.05, 9, 9, 9])).toBeCloseTo(1.05, 12);
  });
});

describe('warpNormRadius', () => {
  it('is the distance to the FARTHEST corner, which is half the diagonal when centred', () => {
    expect(warpNormRadius(dji, W, H)).toBeCloseTo(Math.hypot(W, H) / 2, 6);
    // Off-centre, it is the far corner and not the near one.
    const off: DngWarp = { ...dji, centerH: 0.25, centerV: 0.25 };
    expect(warpNormRadius(off, W, H)).toBeCloseTo(Math.hypot(0.75 * W, 0.75 * H), 6);
  });
});

describe('warpSourcePoint', () => {
  it('leaves the optical centre alone, whatever the coefficients', () => {
    expect(warpSourcePoint(0, 0, plane(1.05, 3, 2, 1))).toEqual([0, 0]);
  });

  it('is a pure SCALE when only k0 is set — the DJI case', () => {
    const [x, y] = warpSourcePoint(0.6, -0.4, plane(1.0493));
    expect(x).toBeCloseTo(0.6 * 1.0493, 12);
    expect(y).toBeCloseTo(-0.4 * 1.0493, 12);
  });

  it('carries the tangential terms rather than dropping them', () => {
    const [x, y] = warpSourcePoint(0.5, 0.25, plane(1, 0, 0, 0, 0.01, 0.02));
    // r² = 0.3125; x: 1·0.5 + 0.01(0.3125 + 2·0.25) + 2·0.02·0.125
    expect(x).toBeCloseTo(0.5 + 0.01 * 0.8125 + 0.04 * 0.125, 12);
    expect(y).toBeCloseTo(0.25 + 0.02 * (0.3125 + 2 * 0.0625) + 0.02 * 0.125, 12);
  });
});

describe('warpSourceUv', () => {
  it('magnifies about the centre: a corrected corner comes from further out', () => {
    const [u, v] = warpSourceUv(dji, 1, 1, 1, W, H);
    // 4.93 % past the corner, so the corrected picture is the middle 95 % of
    // the frame — which is what a magnification means.
    expect(u).toBeCloseTo(0.5 + 0.5 * 1.0493, 6);
    expect(v).toBeCloseTo(0.5 + 0.5 * 1.0493, 6);
    expect(warpSourceUv(dji, 1, 0.5, 0.5, W, H)).toEqual([0.5, 0.5]);
  });

  it('gives each plane its own position — the lateral CA of the file', () => {
    const [ur] = warpSourceUv(dji, 0, 1, 1, W, H);
    const [ug] = warpSourceUv(dji, 1, 1, 1, W, H);
    expect(ur).not.toBeCloseTo(ug, 8);
    // A one-plane warp answers for all three.
    const one: DngWarp = { planes: [plane(1.02)], centerH: 0.5, centerV: 0.5 };
    expect(planeOf(one, 2).radial[0]).toBe(1.02);
    expect(warpSourceUv(one, 2, 1, 1, W, H)).toEqual(warpSourceUv(one, 0, 1, 1, W, H));
  });
});

describe('describeWarp', () => {
  it('says the magnification, and the fringe it takes off', () => {
    expect(describeWarp(dji, W, H)).toMatch(/^×1\.049/);
    expect(describeWarp(dji, W, H)).toMatch(/CA \d+\.\d px at the corner/);
    expect(describeWarp(null)).toBe('');
  });
});
