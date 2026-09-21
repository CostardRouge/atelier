import { describe, expect, it } from 'vitest';
import { megapixels, pictureFidelity, pixelsLabel, shortfallLabel } from './picture-fidelity';

function file(name: string, type = 'image/jpeg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('megapixels', () => {
  it('counts a sensor plane and a render', () => {
    expect(megapixels(8064, 4536)).toBeCloseTo(36.58, 2);
    expect(megapixels(960, 540)).toBeCloseTo(0.518, 3);
  });
});

describe('pixelsLabel', () => {
  it('says the frame and the megapixels', () => {
    expect(pixelsLabel({ width: 8064, height: 4536 })).toBe('8064 × 4536 · 36.6 MP');
  });

  it('claims nothing without a measurement', () => {
    expect(pixelsLabel(null)).toBeNull();
    expect(pixelsLabel({ width: 0, height: 0 })).toBeNull();
  });
});

describe('shortfallLabel', () => {
  it('measures the DJI DNG: 8.4× short on the long edge', () => {
    expect(shortfallLabel({ width: 960, height: 540 }, { width: 8064, height: 4536 })).toBe(
      '8.4× short on the long edge of its 8064 × 4536',
    );
  });

  it('says nothing when what is shown already reaches the file', () => {
    expect(shortfallLabel({ width: 6000, height: 4000 }, { width: 6000, height: 4000 })).toBeNull();
    // A percent of rounding is not a shortfall.
    expect(shortfallLabel({ width: 6000, height: 4000 }, { width: 6010, height: 4006 })).toBeNull();
  });

  it('says nothing when the file is not known', () => {
    expect(shortfallLabel({ width: 960, height: 540 }, null)).toBeNull();
  });
});

describe('pictureFidelity', () => {
  it('has nothing to say about no picture', () => {
    expect(pictureFidelity(null)).toEqual({ chip: null, note: null });
  });

  it('names the pixels of an ordinary 8-bit picture', () => {
    const f = pictureFidelity(file('A.jpg'), null, { width: 6000, height: 4000 });
    expect(f.chip).toBe('JPEG · 8-bit · 6000 × 4000');
    expect(f.note).toContain('6000 × 4000 · 24.0 MP');
  });

  it('says a RAW is a camera render, how big it is, and how far short', () => {
    const f = pictureFidelity(file('DJI_0101.DNG', ''), null, {
      width: 960,
      height: 540,
      viaRawPreview: true,
      full: { width: 8064, height: 4536 },
    });
    expect(f.chip).toBe('RAW · camera render · 960 × 540');
    expect(f.note).toContain('960 × 540 · 0.5 MP');
    expect(f.note).toContain('8.4× short on the long edge of its 8064 × 4536');
  });

  it('still refuses to call a RAW render the sensor when nothing was measured', () => {
    const f = pictureFidelity(file('DJI_0101.DNG', ''));
    expect(f.chip).toBe('RAW · camera render');
    expect(f.note).toContain('not the sensor data');
    // No size was handed in, so none is claimed.
    expect(f.note).not.toContain('MP');
  });

  it('reads a fetched original by its NAME, since an instance hands it over with no type', () => {
    const f = pictureFidelity(file('DJI_0101.JPG', ''), null, { width: 8064, height: 4536 });
    expect(f.chip).toBe('JPEG · 8-bit · 8064 × 4536');
    expect(pictureFidelity(file('DJI_0001.MP4', '')).chip).toBe('clip · 8-bit');
  });

  it('names the sensor on a RAW base', () => {
    const f = pictureFidelity(file('DJI_0101.DNG', ''), 'gain', { width: 8064, height: 4536 });
    expect(f.chip).toBe('RAW · 16-bit linear · 8064 × 4536');
    expect(f.note).toContain('8064 × 4536 · 36.6 MP');
  });
});
