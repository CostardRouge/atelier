import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAMING,
  canPan,
  framingTransform,
  isDefaultFraming,
  normaliseFraming,
  panBy,
  reclampFraming,
  wrapDegrees,
  type Framing,
} from './framing';

/** The four corners of the destination rect, in the picture's own axes. */
function dstCornersInPictureSpace(dstW: number, dstH: number, t: ReturnType<typeof framingTransform>) {
  const cos = Math.cos(-t.angle);
  const sin = Math.sin(-t.angle);
  return [
    [-dstW / 2, -dstH / 2],
    [dstW / 2, -dstH / 2],
    [dstW / 2, dstH / 2],
    [-dstW / 2, dstH / 2],
  ].map(([x, y]) => [x * cos - y * sin - t.panX, x * sin + y * cos - t.panY]);
}

/** Does the transformed picture cover the whole frame? */
function covers(srcW: number, srcH: number, dstW: number, dstH: number, f: Framing): boolean {
  const t = framingTransform(srcW, srcH, dstW, dstH, f);
  const halfW = (srcW * t.scale) / 2;
  const halfH = (srcH * t.scale) / 2;
  // A hair of tolerance: these are floating-point equalities at scale 1.
  const eps = 1e-6 * Math.max(halfW, halfH);
  return dstCornersInPictureSpace(dstW, dstH, t).every(
    ([x, y]) => Math.abs(x) <= halfW + eps && Math.abs(y) <= halfH + eps,
  );
}

describe('framingTransform', () => {
  it('reproduces the centred cover-crop by default', () => {
    // A 3:2 photograph into a 9:16 frame: the sides go, nothing else moves.
    const t = framingTransform(3000, 2000, 1080, 1920, DEFAULT_FRAMING);
    expect(t.angle).toBe(0);
    expect(t.panX).toBe(0);
    expect(t.panY).toBe(0);
    // Scale is set by the height, which is the short side here.
    expect(t.scale).toBeCloseTo(1920 / 2000, 10);
    // Exactly covering leaves slack across, none down.
    expect(t.slackX).toBeGreaterThan(0);
    expect(t.slackY).toBeCloseTo(0, 6);
  });

  it('covers the frame at every rotation, scale and pan', () => {
    const sizes: Array<[number, number]> = [
      [3000, 2000],
      [2000, 3000],
      [1000, 1000],
      [4000, 1000],
    ];
    for (const [sw, sh] of sizes) {
      for (const rotation of [0, 7, 45, 90, 123, 180, -33, -90]) {
        for (const scale of [1, 1.4, 3]) {
          const f: Framing = { scale, rotation, x: 5, y: -5 };
          expect(covers(sw, sh, 1080, 1920, f)).toBe(true);
          expect(covers(sw, sh, 1920, 1080, f)).toBe(true);
        }
      }
    }
  });

  it('clamps a pan that would open a gap', () => {
    // Square source, square frame, no zoom: there is nowhere to go.
    const t = framingTransform(2000, 2000, 1000, 1000, { scale: 1, x: 0.9, y: 0.9, rotation: 0 });
    expect(t.panX).toBe(0);
    expect(t.panY).toBe(0);
    expect(t.slackX).toBeCloseTo(0, 6);
  });

  it('refuses a scale below 1, whatever the document says', () => {
    const wide = framingTransform(3000, 2000, 1080, 1920, {
      ...DEFAULT_FRAMING,
      scale: 0.2,
    });
    expect(wide.scale).toBeCloseTo(framingTransform(3000, 2000, 1080, 1920).scale, 10);
    expect(covers(3000, 2000, 1080, 1920, { scale: 0.2, x: 0, y: 0, rotation: 0 })).toBe(true);
  });

  it('is resolution-independent: the same framing at two sizes', () => {
    const f: Framing = { scale: 2, x: 0.1, y: -0.05, rotation: 12 };
    const small = framingTransform(3000, 2000, 540, 960, f);
    const big = framingTransform(3000, 2000, 2160, 3840, f);
    expect(big.scale / small.scale).toBeCloseTo(4, 10);
    expect(big.panX / small.panX).toBeCloseTo(4, 10);
    expect(big.panY / small.panY).toBeCloseTo(4, 10);
  });

  it('survives a zero-sized source or frame', () => {
    expect(() => framingTransform(0, 0, 100, 100)).not.toThrow();
    expect(framingTransform(100, 100, 0, 0).scale).toBe(1);
  });
});

describe('panBy', () => {
  it('moves the picture with the pointer when there is room', () => {
    const f = panBy({ scale: 2, x: 0, y: 0, rotation: 0 }, 2000, 2000, 1000, 1000, 100, 0);
    expect(f.x).toBeCloseTo(0.1, 10);
    expect(f.y).toBe(0);
  });

  it('turns a frame-axis drag into the picture own axes', () => {
    // Rotated a quarter turn, dragging right moves the picture along what is
    // now its vertical axis.
    const f = panBy({ scale: 3, x: 0, y: 0, rotation: 90 }, 2000, 2000, 1000, 1000, 100, 0);
    expect(f.x).toBeCloseTo(0, 6);
    expect(Math.abs(f.y)).toBeCloseTo(0.1, 6);
  });

  it('never stores a pan that opens a gap', () => {
    const f = panBy({ scale: 1, x: 0, y: 0, rotation: 0 }, 2000, 2000, 1000, 1000, 9999, 9999);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(covers(2000, 2000, 1000, 1000, f)).toBe(true);
  });
});

describe('reclampFraming', () => {
  it('pulls a pan back in when the zoom is undone', () => {
    const zoomed = panBy({ scale: 3, x: 0, y: 0, rotation: 0 }, 2000, 2000, 1000, 1000, 400, 0);
    expect(zoomed.x).toBeGreaterThan(0);
    const out = reclampFraming({ ...zoomed, scale: 1 }, 2000, 2000, 1000, 1000);
    expect(out.x).toBeCloseTo(0, 6);
  });
});

describe('normaliseFraming', () => {
  it('reads an absent or broken value as the default', () => {
    expect(normaliseFraming(undefined)).toEqual(DEFAULT_FRAMING);
    expect(normaliseFraming(null)).toEqual(DEFAULT_FRAMING);
    expect(normaliseFraming({ scale: NaN, x: 'no', rotation: Infinity })).toEqual(
      DEFAULT_FRAMING,
    );
  });

  it('clamps what it reads', () => {
    expect(normaliseFraming({ scale: 0.1 }).scale).toBe(1);
    expect(normaliseFraming({ scale: 99 }).scale).toBe(8);
    expect(normaliseFraming({ rotation: 540 }).rotation).toBe(180);
  });
});

describe('wrapDegrees', () => {
  it('lands every angle in (-180, 180]', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(360)).toBe(0);
    expect(wrapDegrees(-360)).toBe(0);
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
  });
});

describe('isDefaultFraming and canPan', () => {
  it('knows an untouched picture', () => {
    expect(isDefaultFraming(undefined)).toBe(true);
    expect(isDefaultFraming(DEFAULT_FRAMING)).toBe(true);
    expect(isDefaultFraming({ ...DEFAULT_FRAMING, rotation: 1 })).toBe(false);
  });

  it('says when there is nothing to drag', () => {
    expect(canPan(1000, 1000, 1000, 1000, DEFAULT_FRAMING)).toBe(false);
    expect(canPan(1000, 1000, 1000, 1000, { ...DEFAULT_FRAMING, scale: 1.5 })).toBe(true);
    // A 3:2 photo in a 9:16 frame has room sideways with no zoom at all.
    expect(canPan(3000, 2000, 1080, 1920, DEFAULT_FRAMING)).toBe(true);
  });
});
