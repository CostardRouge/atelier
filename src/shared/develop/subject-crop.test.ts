import { describe, expect, it } from 'vitest';
import type { BrushRaster } from '../render/brush-raster';
import { zoneValid } from './crop-rect';
import {
  MAX_SUBJECT,
  MIN_SUBJECT,
  SUBJECT_MARGIN,
  describeSubjectCrop,
  maskBounds,
  settleZone,
  subjectZone,
} from './subject-crop';

const SRC = { width: 400, height: 300 };

/** A mask with one filled rectangle, in shares of a 100×75 raster. */
function mask(x0: number, y0: number, x1: number, y1: number, w = 100, h = 75): BrushRaster {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = x / w;
      const sy = y / h;
      if (sx >= x0 && sx < x1 && sy >= y0 && sy < y1) data[y * w + x] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe('maskBounds', () => {
  it('reads the box and the covered share', () => {
    const b = maskBounds(mask(0.2, 0.4, 0.5, 0.8))!;
    expect(b.x0).toBeCloseTo(0.2, 6);
    expect(b.x1).toBeCloseTo(0.5, 6);
    expect(b.y0).toBeCloseTo(0.4, 6);
    expect(b.y1).toBeCloseTo(0.8, 6);
    expect(b.area).toBeCloseTo(0.3 * 0.4, 2);
  });

  it('is null for an empty mask', () => {
    expect(maskBounds({ data: new Uint8Array(12), width: 4, height: 3 })).toBeNull();
  });
});

describe('subjectZone', () => {
  const centred = maskBounds(mask(0.4, 0.4, 0.6, 0.6))!;

  it('pads the subject by a share of its longer side, in the zone’s frame', () => {
    const r = subjectZone(centred, SRC, 0, false, false, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 0.2 of 400 = 80 wide, 0.2 of 300 = 60 tall; pad is 12 % of 80 each side.
    const pad = 80 * SUBJECT_MARGIN;
    expect(r.zone.w).toBeCloseTo(80 + 2 * pad, 6);
    expect(r.zone.h).toBeCloseTo(60 + 2 * pad, 6);
    expect(r.zone.cx).toBeCloseTo(0, 6);
    expect(r.zone.cy).toBeCloseTo(0, 6);
    expect(zoneValid(r.zone, 0, SRC)).toBe(true);
  });

  it('grows the shorter side to a locked ratio and never cuts the subject', () => {
    const r = subjectZone(centred, SRC, 0, false, false, 1);
    if (!r.ok) throw new Error(r.reason);
    expect(r.zone.w).toBeCloseTo(r.zone.h, 6);
    expect(r.zone.w).toBeCloseTo(80 + 2 * 80 * SUBJECT_MARGIN, 6);
  });

  it('slides a subject at the edge inside the picture, keeping its size', () => {
    const edge = maskBounds(mask(0.8, 0.3, 1, 0.7))!;
    const r = subjectZone(edge, SRC, 0, false, false, null);
    if (!r.ok) throw new Error(r.reason);
    const pad = 120 * SUBJECT_MARGIN; // the box is 120 tall, 80 wide
    expect(r.zone.w).toBeCloseTo(80 + 2 * pad, 6);
    expect(r.zone.h).toBeCloseTo(120 + 2 * pad, 6);
    // Moved left just enough: its right edge sits on the picture's.
    expect(r.zone.cx + r.zone.w / 2).toBeCloseTo(200, 3);
    expect(zoneValid(r.zone, 0, SRC)).toBe(true);
  });

  it('mirrors the centre under a flip and turns the box with a quarter', () => {
    const left = maskBounds(mask(0.1, 0.4, 0.3, 0.6))!;
    const plain = subjectZone(left, SRC, 0, false, false, null);
    const flipped = subjectZone(left, SRC, 0, true, false, null);
    if (!plain.ok || !flipped.ok) throw new Error('refused');
    expect(flipped.zone.cx).toBeCloseTo(-plain.zone.cx, 6);
    const turned = subjectZone(centred, SRC, 90, false, false, null);
    if (!turned.ok) throw new Error(turned.reason);
    // A 80 × 60 box turned a quarter is 60 × 80, padded the same.
    const pad = 80 * SUBJECT_MARGIN;
    expect(turned.zone.w).toBeCloseTo(60 + 2 * pad, 6);
    expect(turned.zone.h).toBeCloseTo(80 + 2 * pad, 6);
    expect(zoneValid(turned.zone, 90, SRC)).toBe(true);
  });

  it('is a valid zone on a straightened picture too', () => {
    const r = subjectZone(centred, SRC, 4, false, false, 1.5);
    if (!r.ok) throw new Error(r.reason);
    expect(zoneValid(r.zone, 4, SRC)).toBe(true);
    expect(r.zone.w / r.zone.h).toBeCloseTo(1.5, 6);
  });

  it('refuses a speck and refuses the whole picture, saying which', () => {
    const speck = subjectZone(maskBounds(mask(0.5, 0.5, 0.52, 0.52))!, SRC, 0, false, false, null);
    expect(speck.ok).toBe(false);
    expect(describeSubjectCrop(speck, 'centre')).toMatch(/too small/);
    expect(MIN_SUBJECT).toBeGreaterThan(0.02 * 0.02 - 1e-9);
    const whole = subjectZone(maskBounds(mask(0.02, 0.02, 0.98, 0.98))!, SRC, 0, false, false, null);
    expect(whole.ok).toBe(false);
    expect(describeSubjectCrop(whole, 'layers')).toMatch(/whole picture/);
    expect(MAX_SUBJECT).toBeLessThan(0.96);
  });

  it('says where the subject came from', () => {
    const r = subjectZone(centred, SRC, 0, false, false, null);
    expect(describeSubjectCrop(r, 'layers')).toBe('cropped to the subject you picked');
    expect(describeSubjectCrop(r, 'centre')).toBe('cropped to what the model finds at the centre');
  });
});

describe('settleZone', () => {
  it('leaves a zone that fits alone', () => {
    const z = { cx: 10, cy: -5, w: 100, h: 80 };
    expect(settleZone(z, 0, SRC)).toEqual(z);
  });

  it('shrinks only when even the middle cannot hold the zone', () => {
    const z = settleZone({ cx: 50, cy: 0, w: 500, h: 100 }, 0, SRC);
    expect(z.w).toBeLessThan(500);
    expect(zoneValid(z, 0, SRC)).toBe(true);
  });
});
