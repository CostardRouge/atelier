import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING } from '../media/framing';
import { clipDelivery, clipOutputSize } from './roll-clip-render';

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

describe('clipDelivery — a clip’s crop, the still export’s arithmetic', () => {
  const hd = { width: 1920, height: 1080 };

  it('is the clip’s own frame with no crop, capped like clipOutputSize', () => {
    const d = clipDelivery(hd, 'original', null, null);
    expect(d.out).toEqual(hd);
    expect(d.cropped).toBe(false);
    expect(d.resized).toBe(false);
    expect(d.framing).toEqual(DEFAULT_FRAMING);
    const capped = clipDelivery(hd, undefined, { ...DEFAULT_FRAMING }, { mode: 'long', value: 1280 });
    expect(capped.out).toEqual(clipOutputSize(hd, 1280));
    expect(capped.cropped).toBe(false);
    expect(capped.resized).toBe(true);
  });

  it('cuts a named shape at the clip’s own density, never blown up to the aspect box', () => {
    // 1:1 out of 1080p is the 1080 × 1080 the picture really holds.
    const d = clipDelivery(hd, '1:1', null, null);
    expect(d.out).toEqual({ width: 1080, height: 1080 });
    expect(d.zone).toEqual({ w: 1080, h: 1080 });
    expect(d.layout).toEqual({ w: 1080, h: 1080, x: 0, y: 0, pw: 1080, ph: 1080 });
    expect(d.cropped).toBe(true);
    // A zoom halves the zone: 960 × 540 of the same pixels.
    const zoomed = clipDelivery(hd, 'original', { ...DEFAULT_FRAMING, scale: 2 }, null);
    expect(zoomed.out).toEqual({ width: 960, height: 540 });
    expect(zoomed.framing.scale).toBe(2);
  });

  it('reads the cap against the DELIVERED frame and keeps the file even', () => {
    // 4:5 out of 1080p is 864 × 1080; a 720 long edge caps it to 576 × 720.
    const d = clipDelivery(hd, '4:5', null, { mode: 'long', value: 720 });
    expect(d.out).toEqual({ width: 576, height: 720 });
    // A cap above the delivered frame changes nothing.
    expect(clipDelivery(hd, '4:5', null, { mode: 'long', value: 4000 }).out).toEqual({ width: 864, height: 1080 });
    // An odd zone is rounded to even, the encoder's rule.
    const odd = clipDelivery({ width: 1281, height: 721 }, 'original', null, null);
    expect(odd.out.width % 2).toBe(0);
    expect(odd.out.height % 2).toBe(0);
  });
});
