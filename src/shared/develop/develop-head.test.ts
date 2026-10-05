import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP, developStage, type DevelopSettings } from './develop';
import { HEAD_TABLE_SIZE, developHead, developTail, isDefaultTail } from './develop-head';
import { fromLinear, toLinear } from '../lut/transfer';

const RAW: DevelopSettings = {
  ...DEFAULT_DEVELOP,
  base: 'gain',
  rawGain: 4,
  exposure: 1.5,
  shadows: 80,
  blacks: 30,
  contrast: 40,
  temperature: -20,
  tint: 10,
  saturation: 15,
  vibrance: 20,
  curves: {
    luma: [
      { x: 0, y: 0 },
      { x: 0.15, y: 0.3 },
      { x: 0.6, y: 0.7 },
      { x: 1, y: 1 },
    ],
    rgb: null,
    red: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.6 },
      { x: 1, y: 1 },
    ],
    green: null,
    blue: null,
  },
  levels: { rgb: { inBlack: 0.02, inWhite: 0.98, gamma: 1.1, outBlack: 0, outWhite: 1 }, red: null, green: null, blue: null },
  rawWb: { kelvin: 4500, tint: 5, matrix: [1.1, 0.02, -0.05, 0.01, 0.98, 0.03, -0.04, 0.05, 1.15] },
  mixer: null,
  grading: {
    shadows: { hue: 220, saturation: 30, luminance: 0 },
    midtones: { hue: 0, saturation: 0, luminance: 0 },
    highlights: { hue: 40, saturation: 20, luminance: -10 },
    global: { hue: 0, saturation: 0, luminance: 0 },
    blending: 50,
    balance: 0,
  },
};

/** The whole develop, per pixel, through the head's stage and then the tail's — must be the stage itself. */
function split(d: DevelopSettings) {
  const head = developHead(d);
  const tail = isDefaultTail(d) ? null : developStage(developTail(d));
  return (r: number, g: number, b: number): [number, number, number] => {
    let out: [number, number, number] = head ? head.stage(r, g, b) : [r, g, b];
    if (tail) out = tail(out[0], out[1], out[2]);
    return out;
  };
}

/**
 * Over probes the HEAD keeps under white: the tail's stage runs on the head's
 * output clamped to [0,1], as the cube's lattice does, so above white the
 * wheels now tint the clipped value rather than the headroom — a pixel that
 * leaves clipped either way.
 */
function worstOver(
  a: (r: number, g: number, b: number) => number[],
  b: (r: number, g: number, b: number) => number[],
  underWhite: (r: number, g: number, b: number) => boolean = () => true,
): number {
  let worst = 0;
  for (let i = 0; i <= 64; i += 1) {
    const v = i / 64;
    const probes: [number, number, number][] = [
      [v, v, v],
      [v, v * 0.6, v * 0.3],
      [v * 0.2, v * 0.9, v * 0.5],
      [(v * 7) % 1, (v * 3) % 1, (v * 11) % 1],
    ];
    for (const [r, g, bl] of probes) {
      if (!underWhite(r, g, bl)) continue;
      const x = a(r, g, bl);
      const y = b(r, g, bl);
      for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(x[c] - y[c]));
    }
  }
  return worst;
}

describe('developHead', () => {
  it('is null for a default develop, and for one that is all tail', () => {
    expect(developHead(null)).toBeNull();
    expect(developHead(DEFAULT_DEVELOP)).toBeNull();
    const grading = { ...DEFAULT_DEVELOP, grading: RAW.grading };
    expect(developHead(grading)).toBeNull();
    expect(isDefaultTail(grading)).toBe(false);
    expect(isDefaultTail(DEFAULT_DEVELOP)).toBe(true);
  });

  it('with the tail is the whole stage, to the last ulp of a double, under white', () => {
    const head = developHead(RAW)!;
    // Under white with a margin: a channel clipped to 1 encodes to 0.9999…
    const under = (r: number, g: number, b: number) => Math.max(...head.stage(r, g, b)) < 0.999;
    let probed = 0;
    expect(
      worstOver(developStage(RAW), split(RAW), (r, g, b) => {
        const ok = under(r, g, b);
        if (ok) probed += 1;
        return ok;
      }),
    ).toBeLessThan(1e-9);
    expect(probed).toBeGreaterThan(40);
    const render: DevelopSettings = { ...RAW, base: null, rawGain: null, rawWb: null, grading: null };
    expect(worstOver(developStage(render), split(render))).toBeLessThan(1e-9);
  });

  it('folds the gains and the matrix as developLinear takes them', () => {
    const head = developHead(RAW)!;
    expect(head.gain).toBe(4);
    expect(head.matrix).toEqual(RAW.rawWb!.matrix);
    const e = Math.pow(2, 1.5);
    expect(head.gains[0]).toBeCloseTo((1 - 0.05) * e, 12);
    expect(head.gains[1]).toBeCloseTo((1 - 0.02) * e, 12);
    expect(head.gains[2]).toBeCloseTo((1 + 0.05) * e, 12);
    expect(head.saturation).toBe(15);
    expect(head.vibrance).toBe(20);
    // A render's develop carries no matrix even with one stored on it.
    expect(developHead({ ...RAW, base: null, rawGain: null })!.matrix).toBeNull();
  });

  it('tabulates the tone and luma curves as OUTPUT luminance, bounded where a ratio would not be', () => {
    const head = developHead(RAW)!;
    expect(head.tone!.length).toBe(HEAD_TABLE_SIZE);
    expect(head.luma!.length).toBe(HEAD_TABLE_SIZE);
    // Blacks lifted: the curve leaves black above 0, and the table says so at
    // its first entry rather than diverging (a ratio there would be ∞).
    expect(developHead({ ...DEFAULT_DEVELOP, blacks: 30 })!.tone![0]).toBeGreaterThan(0);
    expect(head.tone![HEAD_TABLE_SIZE - 1]).toBeLessThanOrEqual(1);
    // The GPU reads the table and divides per pixel: on a grey, that is the
    // stage's own ratio.
    const L = 0.3;
    const Y = toLinear(L, 'srgb');
    const i = L * (HEAD_TABLE_SIZE - 1);
    const lo = Math.floor(i);
    const tone = head.tone![lo] + (head.tone![lo + 1] - head.tone![lo]) * (i - lo);
    const expected = developStage({ ...DEFAULT_DEVELOP, shadows: 80, blacks: 30, contrast: 40 })(L, L, L)[0];
    expect(fromLinear(Y * (tone / Y), 'srgb')).toBeCloseTo(expected, 4);
  });

  it('tabulates levels and the per-channel curves on encoded values, three rows', () => {
    const head = developHead(RAW)!;
    expect(head.channels!.length).toBe(3 * HEAD_TABLE_SIZE);
    // Green has no curve of its own, so its row is the master levels alone;
    // red carries its curve on top.
    const n = HEAD_TABLE_SIZE;
    const mid = Math.round(0.5 * (n - 1));
    expect(head.channels![n + mid]).toBeCloseTo(head.channels![2 * n + mid], 12);
    expect(head.channels![mid]).toBeGreaterThan(head.channels![n + mid]);
    expect(developHead({ ...DEFAULT_DEVELOP, exposure: 1 })!.channels).toBeNull();
    expect(developHead({ ...DEFAULT_DEVELOP, exposure: 1 })!.tone).toBeNull();
  });
});

describe('developTail', () => {
  it('keeps the mixer, mono and grading and rests everything else', () => {
    const tail = developTail(RAW);
    expect(tail.grading).toBe(RAW.grading);
    expect(tail.exposure).toBe(0);
    expect(tail.curves).toBeNull();
    expect(tail.base).toBeNull();
    expect(tail.rawWb).toBeNull();
  });
});
