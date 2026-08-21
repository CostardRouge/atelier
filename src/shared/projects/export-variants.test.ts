import { describe, expect, it } from 'vitest';
import {
  createVariant,
  defaultVariants,
  variantFileName,
  variantOutputSize,
  variantSuffix,
  type ExportVariant,
} from './export-variants';

const variant = (over: Partial<ExportVariant> = {}): ExportVariant => ({
  ...createVariant(),
  ...over,
});

describe('variantOutputSize', () => {
  it('source aspect + source resolution = the source, evened', () => {
    // even() rounds to the nearest even value (3841 → 3842).
    expect(variantOutputSize(variant(), 3841, 2161)).toEqual({ w: 3842, h: 2162 });
    expect(variantOutputSize(variant(), 3840, 2160)).toEqual({ w: 3840, h: 2160 });
  });

  it('caps the SHORT side to the delivery resolution, keeping the ratio', () => {
    const out = variantOutputSize(variant({ resolution: 1080 }), 3840, 2160);
    expect(out).toEqual({ w: 1920, h: 1080 });
  });

  it('never upscales a small source', () => {
    const out = variantOutputSize(variant({ resolution: 1080 }), 1280, 720);
    expect(out).toEqual({ w: 1280, h: 720 });
  });

  it('reframes a landscape source into a vertical preset at source density', () => {
    const out = variantOutputSize(variant({ aspectId: '9:16' }), 3840, 2160);
    // Short side stays 2160 (the crop width); height follows 16/9.
    expect(out).toEqual({ w: 2160, h: 3840 });
  });

  it('vertical preset + 1080p = the platform deliverable', () => {
    const out = variantOutputSize(
      variant({ aspectId: '9:16', resolution: 1080 }),
      3840,
      2160,
    );
    expect(out).toEqual({ w: 1080, h: 1920 });
  });

  it('square preset from a landscape source', () => {
    const out = variantOutputSize(variant({ aspectId: '1:1' }), 1920, 1080);
    expect(out).toEqual({ w: 1080, h: 1080 });
  });
});

describe('naming', () => {
  it('a plain source export keeps a plain name', () => {
    expect(variantSuffix(variant())).toBe('');
    expect(variantFileName('DJI_0001', variant())).toBe('DJI_0001.mp4');
  });

  it('suffixes only what departs from the source', () => {
    const v = variant({
      aspectId: '9:16',
      resolution: 1080,
      frameRate: 30,
      overlays: false,
    });
    expect(variantFileName('vol', v)).toBe('vol-9x16-1080p-30fps-clean.mp4');
    expect(variantFileName('vol', variant({ overlays: false }))).toBe('vol-clean.mp4');
    expect(variantFileName('vol', variant({ frameRate: 24 }))).toBe('vol-24fps.mp4');
  });

  it('trims a pasted .mp4 and falls back on an empty base', () => {
    expect(variantFileName(' clip.mp4 ', variant())).toBe('clip.mp4');
    expect(variantFileName('   ', variant())).toBe('export.mp4');
  });
});

describe('defaults', () => {
  it('one source-faithful variant with overlays on', () => {
    const [v, ...rest] = defaultVariants();
    expect(rest).toHaveLength(0);
    expect(v.aspectId).toBe('source');
    expect(v.resolution).toBe('source');
    expect(v.frameRate).toBe('source');
    expect(v.overlays).toBe(true);
  });
});
