import { describe, expect, it } from 'vitest';
import {
  createVariant,
  defaultVariants,
  variantFileName,
  variantOutputSize,
  variantSuffix,
  type ExportVariant,
  resolutionShortfall,
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

  it('names a re-timed variant by its speed', () => {
    expect(variantFileName('vol', variant({ speed: 2 }))).toBe('vol-2x.mp4');
    expect(variantFileName('vol', variant({ speed: 0.5 }))).toBe('vol-0.5x.mp4');
    // Normal speed is not a departure, so it adds nothing.
    expect(variantFileName('vol', variant({ speed: 1 }))).toBe('vol.mp4');
    expect(
      variantFileName('vol', variant({ resolution: 1080, speed: 4, overlays: false })),
    ).toBe('vol-1080p-4x-clean.mp4');
  });

  it('trims a pasted .mp4 and falls back on an empty base', () => {
    expect(variantFileName(' clip.mp4 ', variant())).toBe('clip.mp4');
    expect(variantFileName('   ', variant())).toBe('export.mp4');
  });
});

describe('naming a still', () => {
  it('delivers a JPEG, reframed and capped like a clip', () => {
    expect(variantFileName('IMG_8801', variant(), 'photo')).toBe('IMG_8801.jpg');
    expect(
      variantFileName('IMG_8801', variant({ aspectId: '4:5', resolution: 1080 }), 'photo'),
    ).toBe('IMG_8801-4x5-1080p.jpg');
    expect(variantFileName('IMG_8801', variant({ overlays: false }), 'photo')).toBe(
      'IMG_8801-clean.jpg',
    );
  });

  it('never names a still by a cadence or a speed it cannot have', () => {
    const v = variant({ frameRate: 30, speed: 2, resolution: 720 });
    expect(variantSuffix(v, 'photo')).toBe('720p');
    expect(variantFileName('IMG_8801', v, 'photo')).toBe('IMG_8801-720p.jpg');
  });

  it('replaces the other medium’s extension rather than stacking on it', () => {
    expect(variantFileName('shot.mp4', variant(), 'photo')).toBe('shot.jpg');
    expect(variantFileName('shot.jpg', variant(), 'video')).toBe('shot.mp4');
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

describe('resolutionShortfall', () => {
  const v = (over = {}) => ({
    id: 'v',
    aspectId: 'source',
    resolution: 'source',
    frameRate: 'source',
    speed: 1,
    overlays: true,
    ...over,
  }) as Parameters<typeof resolutionShortfall>[0];

  it('says nothing when the variant gets the size it asked for', () => {
    // A 1920x1080 capture cropped to 9:16 at 1080 delivers 1080x1920.
    expect(resolutionShortfall(v({ aspectId: '9:16', resolution: 1080 }), 1920, 1080)).toBeNull();
  });

  it('reports the gap when the source cannot fill the asked-for frame', () => {
    // The case that matters: editing on a 720p proxy, asking for 1080.
    expect(resolutionShortfall(v({ aspectId: '9:16', resolution: 1080 }), 1280, 720)).toEqual({
      asked: 1080,
      delivered: 720,
    });
  });

  it('reports it at the source frame too, not only when reframing', () => {
    expect(resolutionShortfall(v({ resolution: 1080 }), 1280, 720)).toEqual({
      asked: 1080,
      delivered: 720,
    });
  });

  it('asking for less than the source has is not a shortfall', () => {
    expect(resolutionShortfall(v({ resolution: 720 }), 1920, 1080)).toBeNull();
  });

  it('has nothing to say about a source-resolution variant', () => {
    expect(resolutionShortfall(v({ aspectId: '9:16' }), 1280, 720)).toBeNull();
  });

  it('says nothing before the source has produced its dimensions', () => {
    expect(resolutionShortfall(v({ resolution: 1080 }), 0, 0)).toBeNull();
  });
});
