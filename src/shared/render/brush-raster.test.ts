import { describe, expect, it } from 'vitest';
import {
  BRUSH_RASTER_LONG_EDGE,
  brushAt,
  brushRasterSize,
  rasteriseBrush,
  rasteriseBrushFrom,
  releaseBrushWorking,
  type BrushRasterState,
} from './brush-raster';
import { maskAt, strokeCoverage, type BrushStroke } from './mask';
import { mulberry32 } from '../lib/prng';

const dab = (over: Partial<BrushStroke> = {}): BrushStroke => ({
  points: [[0.5, 0.5]],
  radius: 0.2,
  hardness: 0.5,
  erase: false,
  ...over,
});

describe('strokeCoverage', () => {
  it('is FULL on the spine and empty past the radius', () => {
    // A dab at the middle of a SQUARE frame sits at the centred origin, and
    // its radius is in centred units — the half-diagonal.
    const s = dab({ points: [[0.5, 0.5]], radius: 0.3 });
    expect(strokeCoverage(s, 0, 0, 1)).toBe(1);
    expect(strokeCoverage(s, 0.31, 0, 1)).toBe(0);
    expect(strokeCoverage(s, 5, 5, 1)).toBe(0);
  });

  it('falls off monotonically outward', () => {
    const s = dab({ radius: 0.4, hardness: 0 });
    let last = 2;
    for (let d = 0; d <= 0.5; d += 0.01) {
      const c = strokeCoverage(s, d, 0, 1);
      expect(c).toBeLessThanOrEqual(last + 1e-12);
      last = c;
    }
  });

  it('hardness widens the solid core, and never leaves a bare step', () => {
    const soft = dab({ radius: 0.4, hardness: 0 });
    const hard = dab({ radius: 0.4, hardness: 1 });
    // Half way out, a hard brush is still solid and a soft one is not.
    expect(hard.hardness > soft.hardness).toBe(true);
    expect(strokeCoverage(hard, 0.2, 0, 1)).toBeGreaterThan(strokeCoverage(soft, 0.2, 0, 1));
    // Even at hardness 1 the very edge is not a cliff: there is a hair of
    // falloff, or the raster would alias along every stroke.
    expect(strokeCoverage(hard, 0.399, 0, 1)).toBeLessThan(1);
    expect(strokeCoverage(hard, 0.399, 0, 1)).toBeGreaterThan(0);
  });

  it('follows a POLYLINE, not just its ends', () => {
    const line = dab({ points: [[0.2, 0.5], [0.8, 0.5]], radius: 0.1, hardness: 1 });
    // A point ON the run, away from both ends, is covered; one above it is not.
    expect(brushAt([line], 0.5, 0.5)).toBe(1);
    expect(brushAt([line], 0.5, 0.05)).toBe(0);
  });

  it('is a DAB for a one-point stroke rather than nothing', () => {
    expect(brushAt([dab({ points: [[0.5, 0.5]], hardness: 1 })], 0.5, 0.5)).toBe(1);
    expect(brushAt([dab({ points: [] })], 0.5, 0.5)).toBe(0);
  });
});

describe('strokes composite in the order they were painted', () => {
  const paint = dab({ points: [[0.5, 0.5]], radius: 0.4, hardness: 1 });
  const erase = dab({ points: [[0.5, 0.5]], radius: 0.2, hardness: 1, erase: true });

  it('an eraser takes away what is under it', () => {
    expect(brushAt([paint], 0.5, 0.5)).toBe(1);
    expect(brushAt([paint, erase], 0.5, 0.5)).toBe(0);
  });

  it('and a stroke painted AFTER the eraser comes back', () => {
    // This is what makes painting feel like painting: order, not set algebra.
    expect(brushAt([paint, erase, paint], 0.5, 0.5)).toBe(1);
  });

  it('an eraser over nothing leaves nothing, rather than going negative', () => {
    expect(brushAt([erase], 0.5, 0.5)).toBe(0);
  });
});

describe('an empty painted mask', () => {
  it('covers NOTHING — only the absence of a mask is the whole picture', () => {
    expect(maskAt({ kind: 'brush', strokes: [] }, 0.5, 0.5, 0.5)).toBe(0);
    expect(maskAt(null, 0.5, 0.5, 0.5)).toBe(1);
  });
});

describe('the raster', () => {
  it('keeps the frame’s shape with the long edge capped', () => {
    expect(brushRasterSize(1.5)).toEqual({ width: 1024, height: 683 });
    expect(brushRasterSize(0.5)).toEqual({ width: 512, height: 1024 });
    expect(brushRasterSize(1)).toEqual({ width: BRUSH_RASTER_LONG_EDGE, height: 1024 });
  });

  it('is the SAME function as the pure module, texel for texel', () => {
    // The claim `brush-raster.ts` rests on, and what lets the GPU be held to
    // the same tolerance as the procedural shapes.
    const strokes = [
      dab({ points: [[0.3, 0.3], [0.6, 0.55]], radius: 0.25, hardness: 0.3 }),
      dab({ points: [[0.5, 0.45]], radius: 0.1, hardness: 1, erase: true }),
    ];
    const ar = 1.5;
    const r = rasteriseBrush(strokes, ar, 128);
    for (const [fx, fy] of [[0.1, 0.1], [0.3, 0.3], [0.45, 0.4], [0.5, 0.45], [0.62, 0.56], [0.9, 0.8]]) {
      const x = Math.min(r.width - 1, Math.floor(fx * r.width));
      const y = Math.min(r.height - 1, Math.floor(fy * r.height));
      const got = r.data[y * r.width + x] / 255;
      const want = brushAt(strokes, (x + 0.5) / r.width, (y + 0.5) / r.height, ar);
      // One 8-bit code, which is the quantisation and nothing else.
      expect(Math.abs(got - want)).toBeLessThanOrEqual(1 / 255 + 1e-9);
    }
  });

  it('leaves the frame empty where nothing was painted', () => {
    const r = rasteriseBrush([dab({ points: [[0.5, 0.5]], radius: 0.05 })], 1, 64);
    expect(r.data[0]).toBe(0);
    expect(r.data[r.data.length - 1]).toBe(0);
    expect(r.data[Math.floor(r.height / 2) * r.width + Math.floor(r.width / 2)]).toBe(255);
  });

  it('costs the area PAINTED, not the frame', () => {
    // A tiny dab on a big map must not walk every texel — the property that
    // makes a live drag possible. Measured as time, which is crude, so the
    // margin is generous: a full walk is ~250x the work.
    const tiny = [dab({ points: [[0.5, 0.5]], radius: 0.02 })];
    const wide = [dab({ points: [[0.5, 0.5]], radius: 1.4 })];
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) rasteriseBrush(tiny, 1.5, 512);
    const small = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 20; i += 1) rasteriseBrush(wide, 1.5, 512);
    const big = performance.now() - t1;
    expect(small).toBeLessThan(big);
  });

  it('is empty for no strokes at all', () => {
    const r = rasteriseBrush([], 1, 32);
    expect(r.data.every((v) => v === 0)).toBe(true);
  });
});

describe('rasteriseBrushFrom is rasteriseBrush, step by step, bit for bit', () => {
  const EDGE = 96;
  const AR = 1.5;

  /** A drag the way the editor hands it in: the finished strokes by identity, the live one longer by a point. */
  function* drag(seed: number, plan: { radius: number; hardness: number; erase: boolean; points: number }[]) {
    const rnd = mulberry32(seed);
    const finished: BrushStroke[] = [];
    for (const p of plan) {
      let x = 0.15 + rnd() * 0.7;
      let y = 0.15 + rnd() * 0.7;
      let live: BrushStroke = { points: [[x, y]], radius: p.radius, hardness: p.hardness, erase: p.erase };
      yield [...finished, live];
      for (let k = 1; k < p.points; k += 1) {
        x = Math.min(1, Math.max(0, x + (rnd() - 0.5) * 0.12));
        y = Math.min(1, Math.max(0, y + (rnd() - 0.5) * 0.12));
        live = { ...live, points: [...live.points, [x, y]] };
        yield [...finished, live];
      }
      finished.push(live);
    }
  }

  const PLAN = [
    { radius: 0.15, hardness: 0.4, erase: false, points: 30 },
    { radius: 0.08, hardness: 1, erase: true, points: 12 },
    { radius: 0.2, hardness: 0, erase: false, points: 20 },
    { radius: 0.05, hardness: 0.7, erase: true, points: 1 },
    { radius: 0.12, hardness: 0.5, erase: false, points: 8 },
  ];

  it('agrees with the whole build on every pointer move of five strokes, erasers and dabs included', () => {
    let state: BrushRasterState | null = null;
    let steps = 0;
    for (const strokes of drag(7, PLAN)) {
      state = rasteriseBrushFrom(state, strokes, AR, EDGE);
      expect(state.raster.data).toEqual(rasteriseBrush(strokes, AR, EDGE).data);
      steps += 1;
    }
    expect(steps).toBe(71);
  });

  it('steps in place: a grown stroke is a NEW raster over the SAME bytes, an unchanged one the same raster', () => {
    const it = drag(3, [{ radius: 0.1, hardness: 0.5, erase: false, points: 3 }]);
    const a = rasteriseBrushFrom(null, it.next().value as BrushStroke[], AR, EDGE);
    const grown = it.next().value as BrushStroke[];
    const b = rasteriseBrushFrom(a, grown, AR, EDGE);
    expect(b.raster).not.toBe(a.raster);
    expect(b.raster.data).toBe(a.raster.data);
    // The same strokes again, as a new array of the same content: nothing to
    // step, so the raster's identity holds and nothing downstream rebuilds.
    const c = rasteriseBrushFrom(b, [...grown], AR, EDGE);
    expect(c.raster).toBe(b.raster);
  });

  it('builds whole, and still agrees, when the change is not a step: an undo, another frame, a released state', () => {
    const steps = [...drag(11, PLAN)];
    const at = steps[40];
    const state = rasteriseBrushFrom(null, at, AR, EDGE);
    // An undo: the live stroke one point shorter — not an extension.
    const undone = steps[39];
    const back = rasteriseBrushFrom(state, undone, AR, EDGE);
    expect(back.raster.data).toEqual(rasteriseBrush(undone, AR, EDGE).data);
    expect(back.raster.data).not.toBe(state.raster.data);
    // Another frame shape.
    const portrait = rasteriseBrushFrom(back, undone, 0.8, EDGE);
    expect(portrait.raster.data).toEqual(rasteriseBrush(undone, 0.8, EDGE).data);
    // A state whose working arrays were let go steps as a whole build.
    releaseBrushWorking(portrait);
    expect(portrait.working).toBeNull();
    const next = rasteriseBrushFrom(portrait, steps[41], 0.8, EDGE);
    expect(next.raster.data).toEqual(rasteriseBrush(steps[41], 0.8, EDGE).data);
    expect(next.working).not.toBeNull();
  });

  it('agrees on a stroke painted back over an eraser, point by point', () => {
    let state: BrushRasterState | null = null;
    for (const strokes of drag(5, [
      { radius: 0.3, hardness: 1, erase: false, points: 2 },
      { radius: 0.2, hardness: 1, erase: true, points: 4 },
      { radius: 0.1, hardness: 0.2, erase: false, points: 6 },
    ])) {
      state = rasteriseBrushFrom(state, strokes, 1, 64);
      expect(state.raster.data).toEqual(rasteriseBrush(strokes, 1, 64).data);
    }
  });
});
