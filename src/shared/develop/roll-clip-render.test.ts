import { describe, expect, it } from 'vitest';
import { clipOutputSize } from './roll-clip-render';

describe('clipOutputSize', () => {
  it('caps the long edge, keeps the shape, never upscales, and stays even for the encoder', () => {
    expect(clipOutputSize({ width: 3840, height: 2160 }, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(clipOutputSize({ width: 2160, height: 3840 }, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(clipOutputSize({ width: 1280, height: 720 }, 1920)).toEqual({ width: 1280, height: 720 });
    expect(clipOutputSize({ width: 1280, height: 720 }, null)).toEqual({ width: 1280, height: 720 });
    // 4096 × 2160 at 1000 is 1000 × 527.3 — rounded to the nearest even height.
    expect(clipOutputSize({ width: 4096, height: 2160 }, 1000)).toEqual({ width: 1000, height: 528 });
  });
});
