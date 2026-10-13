import { describe, expect, it } from 'vitest';
import type { SourceStats } from './auto-develop';
import { DEFAULT_DEVELOP, DEVELOP_KEYS } from './develop';
import {
  EXIF_KEYS,
  STATS_DIM,
  describeOwnAnswer,
  exifVector,
  readOwnModelSidecar,
  sameSliders,
  slidersFromOutput,
  slidersOf,
  statsVector,
  type OwnModelSidecar,
} from './own-model';

const stats = (bins: number[], linearMean: [number, number, number] = [0, 0, 0]): SourceStats => ({
  bins,
  total: bins.reduce((a, b) => a + b, 0),
  linearMean,
  counted: bins.reduce((a, b) => a + b, 0),
});

const SIDECAR = {
  kind: 'atelier/develop-net',
  version: 1,
  run: '20261013-091200-develop-mine',
  thumb: 128,
  inputs: {},
  output: { sliders: [...DEVELOP_KEYS], ranges: [3, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
};

describe('statsVector', () => {
  it('resamples the histogram exactly as records.stats_vector does (pinned to numpy)', () => {
    // 256 bins cycling 1..7, means 0.25 / 0.5 / 0.75 — the Python side printed these.
    const v = statsVector(stats(Array.from({ length: 256 }, (_, i) => (i % 7) + 1), [0.25, 0.5, 0.75]));
    expect(v.length).toBe(STATS_DIM);
    const want = [0.0098231827, 0.0186640472, 0.0137524558, 0.0157170923, 0.0176817289, 0.0127701375, 0.021611002, 0.0098231827];
    want.forEach((w, i) => expect(v[i]).toBeCloseTo(w, 8));
    expect(v[31]).toBeCloseTo(0.0157170923, 8);
    expect(v[32]).toBeCloseTo(0.0176817289, 8);
    expect(v[62]).toBeCloseTo(0.021611002, 8);
    expect(v[63]).toBeCloseTo(0.0098231827, 8);
    let sum = 0;
    for (let i = 0; i < 64; i += 1) sum += v[i];
    expect(sum).toBeCloseTo(1, 6);
    expect([v[64], v[65], v[66]]).toEqual([0.25, 0.5, 0.75]);
  });

  it('is zeros without stats and keeps an empty histogram at zero', () => {
    expect([...statsVector(null)]).toEqual(new Array(STATS_DIM).fill(0));
    const v = statsVector(stats([0, 0, 0, 0], [0.1, 0.2, 0.3]));
    expect([...v.slice(0, 64)]).toEqual(new Array(64).fill(0));
    // Float32: the means come back at the nearest single.
    expect(v[64]).toBeCloseTo(0.1, 6);
    expect(v[65]).toBeCloseTo(0.2, 6);
    expect(v[66]).toBeCloseTo(0.3, 6);
  });

  it('passes a 64-bin histogram through as fractions', () => {
    const bins = Array.from({ length: 64 }, (_, i) => i + 1);
    const v = statsVector(stats(bins));
    const total = bins.reduce((a, b) => a + b, 0);
    bins.forEach((b, i) => expect(v[i]).toBeCloseTo(b / total, 7));
  });
});

describe('exifVector', () => {
  it('matches records.exif_vector on the facts', () => {
    expect(EXIF_KEYS.length).toBe(5);
    const v = exifVector({ iso: 400, exposureTime: 0.5, fNumber: 4, focalLength35: 70, exposureBias: -1 });
    expect([...v]).toEqual([2, -1, 2, 1, -1]);
    const w = exifVector({ iso: 800, exposureTime: 1 / 250, fNumber: 2.8, focalLength: 24 });
    expect(w[0]).toBe(3);
    expect(w[1]).toBeCloseTo(-7.965784284662087, 6);
    expect(w[2]).toBeCloseTo(1.4854268271702418, 6);
    expect(w[3]).toBeCloseTo(-0.5443205162238103, 6);
    expect(w[4]).toBe(0);
  });

  it('is zeros where nothing is known', () => {
    expect([...exifVector(null)]).toEqual([0, 0, 0, 0, 0]);
    expect([...exifVector({ make: 'Sony' })]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('readOwnModelSidecar', () => {
  it('reads what train_develop.py writes', () => {
    const s = readOwnModelSidecar(SIDECAR);
    expect(s).not.toBeNull();
    expect(s!.run).toBe('20261013-091200-develop-mine');
    expect(s!.thumb).toBe(128);
    expect(s!.sliders).toEqual([...DEVELOP_KEYS]);
    expect(s!.ranges[0]).toBe(3);
  });

  it('refuses another kind, another version, a stray slider or a mismatched reach', () => {
    expect(readOwnModelSidecar(null)).toBeNull();
    expect(readOwnModelSidecar({ ...SIDECAR, kind: 'atelier/lut' })).toBeNull();
    expect(readOwnModelSidecar({ ...SIDECAR, version: 2 })).toBeNull();
    expect(readOwnModelSidecar({ ...SIDECAR, output: { sliders: ['exposure', 'kelvin'], ranges: [3, 100] } })).toBeNull();
    expect(readOwnModelSidecar({ ...SIDECAR, output: { sliders: ['exposure'], ranges: [3, 100] } })).toBeNull();
    expect(readOwnModelSidecar({ ...SIDECAR, output: { sliders: ['exposure', 'exposure'], ranges: [3, 3] } })).toBeNull();
    expect(readOwnModelSidecar({ ...SIDECAR, thumb: 0 })).toBeNull();
    expect(readOwnModelSidecar({ ...SIDECAR, thumb: 12.5 })).toBeNull();
  });
});

describe('slidersFromOutput', () => {
  const sidecar = readOwnModelSidecar(SIDECAR) as OwnModelSidecar;
  const rest = slidersOf(DEFAULT_DEVELOP);

  it('clamps to the slider’s reach and rounds to its step', () => {
    const out = [0.333, 12.4, -140, 7.5, 0, 0, 0, 33.3, 0, 0, 2.49];
    const s = slidersFromOutput(out, sidecar, rest);
    expect(s.exposure).toBe(0.35);
    expect(s.brightness).toBe(12);
    expect(s.contrast).toBe(-100);
    expect(s.highlights).toBe(8);
    expect(s.temperature).toBe(33);
    expect(s.vibrance).toBe(2);
  });

  it('leaves a slider the model does not answer, and a non-number, as it was', () => {
    const partial = { ...sidecar, sliders: ['exposure', 'contrast'] as OwnModelSidecar['sliders'], ranges: [3, 100] };
    const now = { ...rest, shadows: 40 };
    const s = slidersFromOutput([1, Number.NaN], partial, now);
    expect(s.exposure).toBe(1);
    expect(s.contrast).toBe(0);
    expect(s.shadows).toBe(40);
  });
});

describe('describeOwnAnswer / sameSliders', () => {
  const rest = slidersOf(DEFAULT_DEVELOP);
  it('names the moved sliders, largest first, four at most', () => {
    expect(describeOwnAnswer(rest, rest)).toBe('nothing to change');
    // Ordered by the share of each slider's reach: half a stop of six beats twelve of two hundred.
    expect(describeOwnAnswer(rest, { ...rest, exposure: 0.5, contrast: 12 })).toBe('exposure +0.50 · contrast +12');
    expect(describeOwnAnswer(rest, { ...rest, exposure: 0.35, contrast: 12 })).toBe('contrast +12 · exposure +0.35');
    const many = { ...rest, exposure: -0.5, contrast: 12, shadows: 20, highlights: -30, saturation: 5, vibrance: -3 };
    expect(describeOwnAnswer(rest, many)).toBe('highlights -30 · shadows +20 · exposure -0.50 · contrast +12 · 2 more');
  });
  it('compares the eleven fields and nothing else', () => {
    expect(sameSliders(rest, { ...rest })).toBe(true);
    expect(sameSliders(rest, { ...rest, tint: 1 })).toBe(false);
    expect(sameSliders(slidersOf({ ...DEFAULT_DEVELOP, levels: null }), rest)).toBe(true);
  });
});
