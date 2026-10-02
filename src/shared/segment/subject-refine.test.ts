import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOLERANCE,
  GROW_REFERENCE_EDGE,
  cutConfidence,
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
    expect(normaliseRefine(undefined)).toEqual({ tolerance: 0.5, islands: false, grow: 0 });
    expect(normaliseRefine({ tolerance: -1, grow: 3.6, islands: true })).toEqual({ tolerance: 0.05, islands: true, grow: 4 });
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
