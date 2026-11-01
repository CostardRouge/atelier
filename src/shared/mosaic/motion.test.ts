import { describe, expect, it } from 'vitest';
import { cellRect } from './chain';
import {
  LAND_MS,
  PHOTO_FADE_MS,
  RECIPES,
  RECIPE_MOTIONS,
  REVEAL_LEAD_MS,
  departAt,
  motionOf,
  recipeOf,
  sanitizeMotion,
  sharpnessAlpha,
  stepFrameAt,
  stepLength,
  stepParts,
  type Motion,
  type StepGeometry,
} from './motion';

const W = 960;
const H = 540;
const cell = cellRect(5 * 24 + 7, 24, 40, 22.5);
const geo: StepGeometry = { W, H, count: 24 * 24, cellA: cell, cellB: cell };

describe('the recipes', () => {
  it('every recipe is its own motion, named back from it, a chain whatever its departure', () => {
    for (const r of RECIPES) expect(recipeOf(RECIPE_MOTIONS[r], r)).toBe(r);
    expect(recipeOf({ ...RECIPE_MOTIONS.chain, depart: 'alternate' })).toBe('chain');
    // A chain pulling out and a pull-back share a motion: the name stored wins.
    expect(recipeOf({ ...RECIPE_MOTIONS.chain, depart: 'pull' }, 'dezoom')).toBe('dezoom');
    expect(recipeOf({ ...RECIPE_MOTIONS.chain, depart: 'pull' }, 'chain')).toBe('chain');
    expect(recipeOf({ ...RECIPE_MOTIONS.chain, holdMs: 1200 })).toBe('custom');
    expect(motionOf('chain', { ...RECIPE_MOTIONS.wave, depart: 'pull' })).toEqual({ ...RECIPE_MOTIONS.chain, depart: 'pull' });
    expect(motionOf('wave', RECIPE_MOTIONS.chain)).toEqual(RECIPE_MOTIONS.wave);
    const custom: Motion = { ...RECIPE_MOTIONS.chain, holdMs: 5 };
    expect(motionOf('custom', custom)).toBe(custom);
    expect([0, 1, 2].map((i) => departAt({ ...RECIPE_MOTIONS.chain, depart: 'alternate' }, i))).toEqual(['dive', 'pull', 'dive']);
  });

  it('sanitizes a stored motion field by field', () => {
    expect(sanitizeMotion(null)).toEqual(RECIPE_MOTIONS.chain);
    expect(sanitizeMotion({ depart: 'wave', holdMs: 99999, moveMs: 1, cadenceMs: -4, drift: 'yes' }, RECIPE_MOTIONS.mosaics)).toEqual({
      ...RECIPE_MOTIONS.mosaics,
      depart: 'wave',
      holdMs: 8000,
      moveMs: 300,
      cadenceMs: 0,
    });
  });
});

describe('the parts of a step', () => {
  it('a chain dive is the old step to the millisecond: photo held, dissolved, the dive, the next photo', () => {
    const m = RECIPE_MOTIONS.chain;
    expect(stepParts(m, 1, 'dive', true).map((p) => [p.phase, p.ms])).toEqual([
      ['hold', 1100],
      ['dissolve', PHOTO_FADE_MS],
    ]);
    expect(stepParts(m, 1, 'dive').map((p) => [p.phase, p.ms])).toEqual([
      ['dive', 3800],
      ['resolve', PHOTO_FADE_MS],
      ['hold', 1100],
      ['dissolve', PHOTO_FADE_MS],
    ]);
    // A pull starts at once, as the old zoom-out did.
    expect(stepParts(m, 1, 'pull', true)).toEqual([]);
    expect(stepParts(m, 1, 'pull').map((p) => p.phase)).toEqual(['pull', 'resolve', 'hold', 'dissolve']);
    expect(stepLength(m, 2, 'dive')).toBeCloseTo((3800 + 900 + 1100 + 900) / 2);
    expect(stepLength(m, 100, 'dive')).toBe(stepLength(m, 4, 'dive'));
  });

  it('a reveal is lead, flip, hold — and back when it goes round, or the other way', () => {
    const m = RECIPE_MOTIONS.reveal;
    expect(stepParts(m, 1, 'cut').map((p) => [p.phase, p.ms])).toEqual([
      ['cut', 0],
      ['lead', REVEAL_LEAD_MS],
      ['reveal', 3200],
      ['after', 1800],
    ]);
    expect(stepParts({ ...m, reveal: 'roundTrip' }, 1, 'cut').map((p) => p.phase)).toEqual(['cut', 'lead', 'reveal', 'after', 'back']);
    expect(stepParts({ ...m, reveal: 'toMosaic' }, 1, 'cut').map((p) => p.phase)).toEqual(['cut', 'after', 'back', 'lead']);
  });

  it('a cadence is absorbed by the hold, never by the move', () => {
    const m = { ...RECIPE_MOTIONS.slideshow, cadenceMs: 6000 };
    expect(stepParts(m, 1, 'cut').map((p) => [p.phase, p.ms])).toEqual([
      ['cut', 0],
      ['hold', 6000],
    ]);
    const dive = { ...RECIPE_MOTIONS.mosaics, cadenceMs: 5000 };
    const parts = stepParts(dive, 1, 'dive');
    expect(parts.map((p) => p.phase)).toEqual(['dive', 'land', 'hold']);
    expect(parts[2].ms).toBe(5000 - 4000 - LAND_MS);
    // A cadence shorter than the move: the hold is nothing, the step takes the move.
    expect(stepParts({ ...dive, cadenceMs: 2000 }, 1, 'dive')[2].ms).toBe(0);
  });
});

describe('the frames of a step', () => {
  it('a chain dive gives the old cameras: still and photo, dissolving, then the dive to the cell, crisp', () => {
    const m = RECIPE_MOTIONS.chain;
    const opening = stepFrameAt(m, 1, 'dive', geo, 300, true);
    expect(opening).toMatchObject({ phase: 'hold', base: 'to', photo: 1, cellFill: 0, arrived: true });
    expect(opening.cam).toEqual({ s: 1, vx: 480, vy: 270 });
    expect(stepFrameAt(m, 1, 'dive', geo, 1100 + 450, true).photo).toBeCloseTo(0.5);
    const start = stepFrameAt(m, 1, 'dive', geo, 0);
    expect(start).toMatchObject({ phase: 'dive', base: 'from', cellFill: 0, arrived: false });
    expect(start.cam).toEqual({ s: 1, vx: 480, vy: 270 });
    const end = stepFrameAt(m, 1, 'dive', geo, 3800 - 1);
    expect(end.cam.s).toBeCloseTo(24, 1);
    expect(end.cam.vx).toBeCloseTo(300, 0);
    expect(end.cam.vy).toBeCloseTo(123.75, 0);
    expect(end.cellFill).toBe(1);
    const landed = stepFrameAt(m, 1, 'dive', geo, 3800 + 450);
    expect(landed).toMatchObject({ phase: 'resolve', base: 'to', arrived: true });
    expect(landed.photo).toBeCloseTo(0.5);
    expect(landed.cam).toEqual({ s: 1, vx: 480, vy: 270 });
    expect(stepFrameAt(m, 1, 'dive', geo, 99999).done).toBe(true);
  });

  it('a pull is the dive reversed on the arrived mosaic, the departed picture fading out of its cell', () => {
    const m = RECIPE_MOTIONS.dezoom;
    const start = stepFrameAt(m, 1, 'pull', geo, 0);
    expect(start).toMatchObject({ phase: 'pull', base: 'to', cellFill: 1, arrived: false });
    expect(start.cam.s).toBeCloseTo(24);
    expect(start.cam.vx).toBeCloseTo(300);
    const mid = stepFrameAt(m, 1, 'pull', geo, 1900);
    expect(mid.arrived).toBe(true);
    const end = stepFrameAt(m, 1, 'pull', geo, 3800 - 1);
    expect(end.cam.s).toBeCloseTo(1, 1);
    expect(end.cellFill).toBe(0);
    expect(stepFrameAt(m, 1, 'pull', geo, 3800 + 900 + 500)).toMatchObject({ phase: 'hold', photo: 1 });
  });

  it('a reveal flips the cells of the arrived mosaic to its photo, and back on a round trip', () => {
    const m = RECIPE_MOTIONS.reveal;
    // A cut takes no time: the first frame is already the lead on the arrived mosaic.
    expect(stepFrameAt(m, 1, 'cut', geo, 0)).toMatchObject({ phase: 'lead', base: 'to', arrived: true });
    expect(stepFrameAt(m, 1, 'cut', geo, 500)).toMatchObject({ phase: 'lead', flipped: 0 });
    expect(stepFrameAt(m, 1, 'cut', geo, 1100 + 1600).flipped).toBe(288);
    expect(stepFrameAt(m, 1, 'cut', geo, 1100 + 3200 + 100)).toMatchObject({ phase: 'after', flipped: 576 });
    const round = { ...m, reveal: 'roundTrip' as const };
    expect(stepFrameAt(round, 1, 'cut', geo, 1100 + 3200 + 1800 + 3200 - 1).flipped).toBe(0);
    expect(stepFrameAt(round, 1, 'cut', geo, 1100 + 3200 + 1800 + 3200).done).toBe(true);
  });

  it('a wave lands the next cells on the departed mosaic; a fade crosses; a landing follows a dive with no sharpening', () => {
    expect(stepFrameAt(RECIPE_MOTIONS.wave, 1, 'wave', geo, 1500)).toMatchObject({ phase: 'wave', base: 'from', wave: 288 });
    expect(stepFrameAt(RECIPE_MOTIONS.drift, 1, 'fade', geo, 700).cross).toBeCloseTo(0.5);
    const mosaics = RECIPE_MOTIONS.mosaics;
    expect(stepFrameAt(mosaics, 1, 'dive', geo, 3999).cellFill).toBe(0);
    const land = stepFrameAt(mosaics, 1, 'dive', geo, 4000 + 150);
    expect(land).toMatchObject({ phase: 'land', base: 'from' });
    expect(land.cross).toBeCloseTo(0.5);
    expect(land.cam.s).toBeCloseTo(24);
    expect(stepFrameAt(mosaics, 1, 'dive', geo, 4000 + 300 + 10)).toMatchObject({ phase: 'hold', base: 'to', photo: 0 });
  });

  it('a held mosaic drifts, ramped in and out, so a step starts and ends still', () => {
    const m = RECIPE_MOTIONS.drift;
    const t0 = 1400;
    expect(stepFrameAt(m, 1, 'fade', geo, t0 + 1).cam.s).toBeCloseTo(1, 2);
    expect(stepFrameAt(m, 1, 'fade', geo, t0 + 4000).cam.s).toBeGreaterThan(1.4);
    expect(stepFrameAt(m, 1, 'fade', geo, t0 + 8000 - 1).cam.s).toBeCloseTo(1, 2);
    expect(stepFrameAt(RECIPE_MOTIONS.chain, 1, 'dive', geo, 3800 + 900 + 500).cam.s).toBe(1);
  });

  it('sharpness: early from ×1.6, late from ×3.2, never not at all; the same time gives the same frame', () => {
    expect(sharpnessAlpha(2.4, 'early')).toBeCloseTo(0.5);
    expect(sharpnessAlpha(2.4, 'late')).toBe(0);
    expect(sharpnessAlpha(4.8, 'late')).toBeCloseTo(0.5);
    expect(sharpnessAlpha(50, 'never')).toBe(0);
    const a = stepFrameAt(RECIPE_MOTIONS.chain, 1.3, 'dive', geo, 2750);
    const b = stepFrameAt(RECIPE_MOTIONS.chain, 1.3, 'dive', geo, 2750);
    expect(a).toEqual(b);
    expect(stepFrameAt(RECIPE_MOTIONS.chain, 1, 'dive', geo, -50).cam.s).toBe(1);
  });
});
