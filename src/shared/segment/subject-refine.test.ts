import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE,
  GROW_REFERENCE_EDGE,
  boxMean,
  cutConfidence,
  finishEdge,
  snapEdge,
  softEdge,
  growPixels,
  growShrink,
  isDefaultRefine,
  keepTouching,
  normaliseRefine,
  squaredDistance,
} from './subject-refine';
import { SEGMENT_INPUT_LONG_EDGE, composeSubject } from './segmenter';

const grid = (w: number, h: number, rows: string) => {
  // '#' = 255, '+' = 200, '.' = 0, read row by row.
  const cells = rows.replace(/\s+/g, '');
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i += 1) data[i] = cells[i] === '#' ? 255 : cells[i] === '+' ? 200 : 0;
  return { data, width: w, height: h };
};
const show = (r: { data: Uint8Array; width: number }) =>
  Array.from(r.data, (v) => (v >= 128 ? '#' : '.'))
    .join('')
    .match(new RegExp(`.{${r.width}}`, 'g'))!
    .join(' ');
const conf = (values: number[]) => ({ data: new Uint8Array(values), width: values.length, height: 1 });

describe('the cut on the model\'s confidence', () => {
  it('at the default is the model\'s own category mask: above one half', () => {
    // 127 is under the half, 128 over it — measured against the category mask.
    expect(Array.from(cutConfidence(conf([0, 127, 128, 255])).data)).toEqual([0, 0, 255, 255]);
    expect(DEFAULT_TOLERANCE).toBe(0.5);
  });

  it('takes in what the model was less sure of as the tolerance rises', () => {
    const answer = conf([20, 80, 140, 230]);
    expect(Array.from(cutConfidence(answer, 0.2).data)).toEqual([0, 0, 0, 255]);
    expect(Array.from(cutConfidence(answer, 0.8).data)).toEqual([0, 255, 255, 255]);
  });

  it('is clamped, so no setting takes in the whole picture', () => {
    expect(Array.from(cutConfidence(conf([0, 10, 13]), 1).data)).toEqual([0, 0, 255]);
  });
});

describe('only what touches my + points', () => {
  it('drops the island no added point lands in', () => {
    const two = grid(7, 3, '##...## ##...## .......');
    const out = keepTouching(two, [{ x: 0.05, y: 0.2 }], 1);
    expect(show(out)).toBe('##..... ##..... .......');
  });

  it('keeps a region joined at a corner, and every region a point lands in', () => {
    const r = grid(5, 3, '#.... .#... ....#');
    expect(show(keepTouching(r, [{ x: 0.1, y: 0.1 }], 1))).toBe('#.... .#... .....');
    expect(show(keepTouching(r, [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], 1))).toBe('#.... .#... ....#');
  });

  it('reaches for the nearest region from a point just outside it, and keeps nothing out of reach', () => {
    const r = grid(6, 1, '##....');
    expect(show(keepTouching(r, [{ x: 0.4, y: 0.5 }], 1))).toBe('##....');
    expect(show(keepTouching(r, [{ x: 0.95, y: 0.5 }], 1))).toBe('......');
  });

  it('keeps the values it keeps, soft or not', () => {
    const r = grid(3, 1, '#+.');
    expect(Array.from(keepTouching(r, [{ x: 0.1, y: 0.5 }]).data)).toEqual([255, 200, 0]);
  });
});

describe('grow and shrink', () => {
  const dot = grid(7, 7, '....... ....... ....... ...#... ....... ....... .......');

  it('grows by a disc, not a square', () => {
    expect(show(growShrink(dot, 2))).toBe('....... ...#... ..###.. .#####. ..###.. ...#... .......');
  });

  it('shrinks from the ground, never from the picture\'s own border', () => {
    const block = grid(5, 5, '####. ####. ####. ####. .....');
    // Its top and left run into the frame: only the right and bottom move.
    expect(show(growShrink(block, -1))).toBe('###.. ###.. ###.. ..... .....');
    const all = grid(3, 3, '### ### ###');
    expect(show(growShrink(all, -2))).toBe('### ### ###');
  });

  it('counts its pixels at the model\'s view, so a small picture moves as much of itself', () => {
    expect(GROW_REFERENCE_EDGE).toBe(SEGMENT_INPUT_LONG_EDGE);
    expect(growPixels(8, { width: 1024, height: 683 })).toBe(8);
    expect(growPixels(8, { width: 300, height: 512 })).toBe(4);
  });

  it('measures an exact Euclidean distance', () => {
    const d = squaredDistance(5, 1, (i) => i === 0);
    expect(Array.from(d)).toEqual([0, 1, 4, 9, 16]);
    const diag = squaredDistance(3, 3, (i) => i === 0);
    expect(diag[8]).toBe(8);
  });
});

describe('the settings', () => {
  it('fill their defaults and are brought into range', () => {
    expect(normaliseRefine(undefined)).toEqual({ tolerance: 0.5, islands: false, grow: 0, edge: 'found' });
    expect(normaliseRefine({ tolerance: -1, grow: 3.6, islands: true })).toEqual({ tolerance: 0.05, islands: true, grow: 4, edge: 'found' });
    expect(normaliseRefine({ edge: 'snap' }).edge).toBe('snap');
    expect(normaliseRefine({ edge: 'lasso' as never }).edge).toBe('found');
    expect(isDefaultRefine({ edge: 'soft' })).toBe(false);
    expect(isDefaultRefine({ tolerance: 0.5, grow: 0 })).toBe(true);
    expect(isDefaultRefine({ islands: true })).toBe(false);
  });
});

describe('composing a refined subject', () => {
  it('cuts, keeps the islands, grows — and only THEN takes the removed region out', () => {
    // 128 px wide, so 8 px at the model's 1024 view is one pixel here.
    const W = 128;
    const H = 8;
    const rect = (x0: number, x1: number, y0: number, y1: number) => {
      const data = new Uint8Array(W * H);
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[y * W + x] = 255;
      return { data, width: W, height: H };
    };
    const at = (r: { data: Uint8Array }, x: number, y: number) => r.data[y * W + x];
    // The person (columns 10–19) came back with a look-alike far right (100–109).
    const answer = rect(10, 20, 0, 4);
    for (let i = 0; i < answer.data.length; i += 1) answer.data[i] = Math.max(answer.data[i], rect(100, 110, 0, 4).data[i]);
    // The bench, tapped out, sits just right of the person (20–29).
    const bench = rect(20, 30, 0, 4);
    const out = composeSubject([answer], [bench], { islands: true, grow: 8, seeds: [{ x: 15 / W, y: 0.25 }] })!;
    expect(at(out, 105, 1)).toBe(0); // the look-alike is gone
    expect(at(out, 9, 1)).toBe(255); // the person grew by a pixel on the left…
    expect(at(out, 15, 4)).toBe(255); // …and below
    expect(at(out, 20, 1)).toBe(0); // but not back into the bench taken out
    expect(at(out, 99, 1)).toBe(0); // and the dropped island did not grow either
  });

  it('cuts a removed region at the same tolerance', () => {
    const subject = conf([255, 255, 255]);
    const removed = conf([0, 100, 200]);
    expect(Array.from(composeSubject([subject], [removed])!.data)).toEqual([255, 255, 0]);
    expect(Array.from(composeSubject([subject], [removed], { tolerance: 0.7 })!.data)).toEqual([255, 0, 0]);
  });

  it('at the defaults draws the model\'s own cut, unchanged', () => {
    const answer = conf([0, 90, 130, 250]);
    expect(Array.from(composeSubject([answer])!.data)).toEqual([0, 0, 255, 255]);
  });
});

describe('the edge', () => {
  // A guide whose subject (bright) is columns 0–19 and ground (dark) 20–39,
  // and a mask the model drew three pixels too wide (0–22).
  const W = 40;
  const H = 16;
  const guide = { data: new Uint8Array(W * H * 4), width: W, height: H };
  const mask = { data: new Uint8Array(W * H), width: W, height: H };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      const v = x < 20 ? 220 : 40;
      guide.data.set([v, v, v, 255], i * 4);
      mask.data[i] = x < 23 ? 255 : 0;
    }
  }
  const row = (r: { data: Uint8Array }, y: number) => Array.from(r.data.slice(y * W, y * W + W));

  it('averages a window clipped at the border', () => {
    const f = Float32Array.from([0, 3, 6, 9]);
    expect(Array.from(boxMean(f, 4, 1, 1))).toEqual([1.5, 3, 6, 7.5]);
  });

  it('snaps an edge drawn too wide back onto the picture\'s own', () => {
    const out = row(snapEdge(mask, guide, 8, 1e-4, 1), 8);
    expect(out[10]).toBeGreaterThan(240); // well inside: still the subject
    expect(out[19]).toBe(255); // the last pixel of the bright side
    // The overshoot onto the ground falls under half at the picture's own
    // edge and clears within a few pixels, where it was fully in…
    expect(out[20]).toBeLessThan(128);
    expect(out[21]).toBeLessThan(90);
    expect(out[22]).toBeLessThan(50);
    expect(out[24]).toBeLessThan(10);
    expect(out[30]).toBe(0); // …and the ground stays clear
    // As found, those two pixels were fully in.
    expect(row(mask, 8)[22]).toBe(255);
  });

  it('snaps alike at half density, the way a big raster runs it', () => {
    const full = row(snapEdge(mask, guide, 8, 1e-4, 1), 8);
    const half = row(snapEdge(mask, guide, 8, 1e-4, 2), 8);
    expect(half[22]).toBeLessThan(50);
    expect(Math.abs(half[10] - full[10])).toBeLessThan(10);
  });

  it('refuses a guide of another size, and leaves the edge as found without one', () => {
    const stale = { data: new Uint8Array(4 * 4), width: 2, height: 2 };
    expect(row(snapEdge(mask, stale, 4), 8)).toEqual(row(mask, 8));
    expect(finishEdge(mask, 'snap', null)).toBe(mask);
    expect(finishEdge(mask, 'found', guide)).toBe(mask);
  });

  it('feathers a SOFT edge across the cut, and leaves the middle alone', () => {
    const out = row(softEdge(mask, 2), 8);
    expect(out[5]).toBe(255);
    expect(out[35]).toBe(0);
    expect(out[22]).toBeGreaterThan(0);
    expect(out[22]).toBeLessThan(255);
    expect(out[23]).toBeGreaterThan(0);
  });

  it('is made LAST, after a removal, so the removal\'s edge is refined too', () => {
    const removed = { data: new Uint8Array(W * H), width: W, height: H };
    for (let i = 0; i < removed.data.length; i += 1) removed.data[i] = i % W < 5 ? 255 : 0;
    const out = row(composeSubject([mask], [removed], { edge: 'soft' })!, 8);
    expect(out[0]).toBe(0);
    expect(out[5]).toBeGreaterThan(0); // the removal's own edge, feathered
    expect(out[5]).toBeLessThan(255);
    expect(out[12]).toBe(255);
  });
});
