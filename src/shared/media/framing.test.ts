import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAMING,
  canPan,
  flipFraming,
  framingTransform,
  isDefaultFraming,
  normaliseFraming,
  panBy,
  reclampFraming,
  sameFraming,
  scaleFramingBy,
  unframePoint,
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

/** Where a source pixel lands in the frame — the same four steps `drawFramed` takes. */
function toFrame(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  f: Framing,
  [px, py]: [number, number],
): [number, number] {
  const t = framingTransform(srcW, srcH, dstW, dstH, f);
  const x = (px - srcW / 2) * t.scale * t.mirrorX + t.panX;
  const y = (py - srcH / 2) * t.scale * t.mirrorY + t.panY;
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return [dstW / 2 + x * cos - y * sin, dstH / 2 + x * sin + y * cos];
}

/** Does the whole transformed picture stay inside the frame? */
function showsWhole(srcW: number, srcH: number, dstW: number, dstH: number, f: Framing): boolean {
  const eps = 1e-6 * Math.max(dstW, dstH);
  return (
    [
      [0, 0],
      [srcW, 0],
      [srcW, srcH],
      [0, srcH],
    ] as Array<[number, number]>
  )
    .map((corner) => toFrame(srcW, srcH, dstW, dstH, f, corner))
    .every(([x, y]) => x >= -eps && x <= dstW + eps && y >= -eps && y <= dstH + eps);
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
          const f: Framing = { ...DEFAULT_FRAMING, scale, rotation, x: 5, y: -5 };
          expect(covers(sw, sh, 1080, 1920, f)).toBe(true);
          expect(covers(sw, sh, 1920, 1080, f)).toBe(true);
        }
      }
    }
  });

  it('clamps a pan that would open a gap', () => {
    // Square source, square frame, no zoom: there is nowhere to go.
    const t = framingTransform(2000, 2000, 1000, 1000, { ...DEFAULT_FRAMING, x: 0.9, y: 0.9 });
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
    expect(covers(3000, 2000, 1080, 1920, { ...DEFAULT_FRAMING, scale: 0.2 })).toBe(true);
  });

  it('is resolution-independent: the same framing at two sizes', () => {
    const f: Framing = { ...DEFAULT_FRAMING, scale: 2, x: 0.1, y: -0.05, rotation: 12 };
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

describe('a contain fit', () => {
  const contain: Framing = { ...DEFAULT_FRAMING, fit: 'contain' };

  it('shows the whole picture, touching the frame on one axis', () => {
    // A 3:2 photograph in a 9:16 frame: full width, bars above and below.
    const t = framingTransform(3000, 2000, 1080, 1920, contain);
    expect(t.scale).toBeCloseTo(1080 / 3000, 10);
    expect(showsWhole(3000, 2000, 1080, 1920, contain)).toBe(true);
    expect(covers(3000, 2000, 1080, 1920, contain)).toBe(false);
  });

  it('keeps the whole picture in view at every rotation and pan', () => {
    for (const [sw, sh] of [
      [3000, 2000],
      [2000, 3000],
      [4000, 1000],
    ] as Array<[number, number]>) {
      for (const rotation of [0, 7, 45, 90, 123, 180, -33]) {
        const f: Framing = { ...contain, rotation, x: 5, y: -5 };
        expect(showsWhole(sw, sh, 1080, 1920, f)).toBe(true);
        expect(showsWhole(sw, sh, 1920, 1080, f)).toBe(true);
      }
    }
  });

  it('lets the picture slide along its bars, and no further', () => {
    const t = framingTransform(3000, 2000, 1080, 1920, { ...contain, y: 1 });
    // 1920 tall, 720 of picture: 600 either side to move through.
    expect(t.slackY).toBeCloseTo(600, 6);
    expect(t.panY).toBeCloseTo(600, 6);
    expect(t.slackX).toBeCloseTo(0, 6);
    expect(canPan(3000, 2000, 1080, 1920, contain)).toBe(true);
  });

  it('crops again once zoomed past covering', () => {
    const f: Framing = { ...contain, scale: 8 };
    expect(covers(3000, 2000, 1080, 1920, f)).toBe(true);
  });

  it('is left alone by a cover framing', () => {
    expect(framingTransform(3000, 2000, 1080, 1920, DEFAULT_FRAMING).scale).toBeCloseTo(
      1920 / 2000,
      10,
    );
  });
});

describe('flipFraming', () => {
  const src: Array<[number, number]> = [
    [0, 0],
    [3000, 0],
    [1200, 1700],
    [3000, 2000],
  ];

  it('mirrors what the frame shows, at any rotation, zoom and pan', () => {
    for (const rotation of [0, 12, 90, -135, 180]) {
      for (const fit of ['cover', 'contain'] as const) {
        const f: Framing = { ...DEFAULT_FRAMING, fit, rotation, scale: 1.7, x: 0.08, y: -0.05 };
        const across = flipFraming(f, 'x');
        const down = flipFraming(f, 'y');
        for (const p of src) {
          const [x, y] = toFrame(3000, 2000, 1080, 1920, f, p);
          const [ax, ay] = toFrame(3000, 2000, 1080, 1920, across, p);
          const [dx, dy] = toFrame(3000, 2000, 1080, 1920, down, p);
          expect(ax).toBeCloseTo(1080 - x, 6);
          expect(ay).toBeCloseTo(y, 6);
          expect(dx).toBeCloseTo(x, 6);
          expect(dy).toBeCloseTo(1920 - y, 6);
        }
      }
    }
  });

  it('comes back to where it started when applied twice', () => {
    const f: Framing = { ...DEFAULT_FRAMING, rotation: 33, x: 0.1, y: 0.02 };
    expect(flipFraming(flipFraming(f, 'x'), 'x')).toEqual(f);
    expect(flipFraming(flipFraming(f, 'y'), 'y')).toEqual(f);
  });

  it('never stores a negative zero', () => {
    const f = flipFraming(DEFAULT_FRAMING, 'x');
    expect(Object.is(f.x, 0)).toBe(true);
    expect(Object.is(f.rotation, 0)).toBe(true);
  });
});

describe('panBy', () => {
  it('moves the picture with the pointer when there is room', () => {
    const f = panBy({ ...DEFAULT_FRAMING, scale: 2 }, 2000, 2000, 1000, 1000, 100, 0);
    expect(f.x).toBeCloseTo(0.1, 10);
    expect(f.y).toBe(0);
  });

  it('turns a frame-axis drag into the picture own axes', () => {
    // Rotated a quarter turn, dragging right moves the picture along what is
    // now its vertical axis.
    const f = panBy({ ...DEFAULT_FRAMING, scale: 3, rotation: 90 }, 2000, 2000, 1000, 1000, 100, 0);
    expect(f.x).toBeCloseTo(0, 6);
    expect(Math.abs(f.y)).toBeCloseTo(0.1, 6);
  });

  it('never stores a pan that opens a gap', () => {
    const f = panBy({ ...DEFAULT_FRAMING }, 2000, 2000, 1000, 1000, 9999, 9999);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
    expect(covers(2000, 2000, 1000, 1000, f)).toBe(true);
  });
});

describe('panBy under a contain fit', () => {
  it('moves along the frame, not along a rotated picture', () => {
    // A thin panorama turned a quarter: a tall strip with room either side.
    const f = panBy(
      { ...DEFAULT_FRAMING, fit: 'contain', rotation: 90 },
      4000,
      1000,
      1920,
      1080,
      100,
      0,
    );
    expect(f.x).toBeCloseTo(100 / 1920, 10);
    expect(f.y).toBe(0);
  });

  it('never drags any part of the picture out of the frame', () => {
    const f = panBy(
      { ...DEFAULT_FRAMING, fit: 'contain', rotation: 30 },
      3000,
      2000,
      1080,
      1920,
      9999,
      -9999,
    );
    expect(showsWhole(3000, 2000, 1080, 1920, f)).toBe(true);
  });
});

describe('reclampFraming', () => {
  it('pulls a pan back in when the zoom is undone', () => {
    const zoomed = panBy({ ...DEFAULT_FRAMING, scale: 3 }, 2000, 2000, 1000, 1000, 400, 0);
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

  it('reads a mirror and a fit, and only the values it knows', () => {
    const f = normaliseFraming({ flipX: true, flipY: 'yes', fit: 'contain' });
    expect(f.flipX).toBe(true);
    expect(f.flipY).toBe(false);
    expect(f.fit).toBe('contain');
    expect(normaliseFraming({ fit: 'stretch' }).fit).toBe('cover');
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
    expect(isDefaultFraming({ ...DEFAULT_FRAMING, flipY: true })).toBe(false);
    expect(isDefaultFraming({ ...DEFAULT_FRAMING, fit: 'contain' })).toBe(false);
  });

  it('compares two framings by what they say, null included', () => {
    expect(sameFraming(null, { ...DEFAULT_FRAMING })).toBe(true);
    expect(sameFraming(null, undefined)).toBe(true);
    expect(sameFraming({ ...DEFAULT_FRAMING, x: 0.25 }, { ...DEFAULT_FRAMING, x: 0.25 })).toBe(true);
    expect(sameFraming({ ...DEFAULT_FRAMING, x: 0.25 }, { ...DEFAULT_FRAMING, x: 0.3 })).toBe(false);
    expect(sameFraming(null, { ...DEFAULT_FRAMING, fit: 'contain' })).toBe(false);
  });

  it('says when there is nothing to drag', () => {
    expect(canPan(1000, 1000, 1000, 1000, DEFAULT_FRAMING)).toBe(false);
    expect(canPan(1000, 1000, 1000, 1000, { ...DEFAULT_FRAMING, scale: 1.5 })).toBe(true);
    // A 3:2 photo in a 9:16 frame has room sideways with no zoom at all.
    expect(canPan(3000, 2000, 1080, 1920, DEFAULT_FRAMING)).toBe(true);
  });
});

describe('scaleFramingBy', () => {
  it('holds a zoom between covering and the ceiling', () => {
    expect(scaleFramingBy(1, 2)).toBe(2);
    expect(scaleFramingBy(2, 0.25)).toBe(1);
    expect(scaleFramingBy(6, 4)).toBe(8);
  });

  it('answers the three ways a zoom is asked for with one number', () => {
    // A wheel notch, a pinch ratio and a button step reaching the same scale.
    const wheel = scaleFramingBy(1, Math.exp(-(-400) / 400));
    expect(wheel).toBeCloseTo(Math.E, 10);
    expect(scaleFramingBy(2, 1.5)).toBe(3);
  });

  it('refuses a factor that is not one', () => {
    expect(scaleFramingBy(2, 0)).toBe(2);
    expect(scaleFramingBy(2, Number.NaN)).toBe(2);
    // A scale that is not a number reads as covering, and the zoom then applies.
    expect(scaleFramingBy(Number.NaN, 2)).toBe(2);
    expect(scaleFramingBy(Number.NaN, 1)).toBe(1);
    expect(scaleFramingBy(20, -1)).toBe(8);
  });
});

describe('unframePoint', () => {
  /** The forward map `drawFramed` composes, so the round trip is a real one. */
  function framePoint(
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    framing: Framing,
  ): [number, number] {
    const t = framingTransform(srcW, srcH, dstW, dstH, framing);
    let x = (srcX - srcW / 2) * t.scale * t.mirrorX;
    let y = (srcY - srcH / 2) * t.scale * t.mirrorY;
    x += t.panX;
    y += t.panY;
    const cos = Math.cos(t.angle);
    const sin = Math.sin(t.angle);
    return [x * cos - y * sin + dstW / 2, x * sin + y * cos + dstH / 2];
  }

  const cases: { name: string; framing: Framing }[] = [
    { name: 'untouched', framing: { ...DEFAULT_FRAMING } },
    { name: 'zoomed and panned', framing: { ...DEFAULT_FRAMING, scale: 1.8, x: 0.1, y: -0.2 } },
    { name: 'rotated', framing: { ...DEFAULT_FRAMING, rotation: 23 } },
    { name: 'flipped both ways', framing: { ...DEFAULT_FRAMING, flipX: true, flipY: true } },
    { name: 'whole, with bars', framing: { ...DEFAULT_FRAMING, fit: 'contain' } },
    { name: 'everything at once', framing: { ...DEFAULT_FRAMING, scale: 2.2, rotation: -37, flipX: true, x: 0.3 } },
  ];

  it('round-trips the transform drawFramed composes', () => {
    for (const { framing } of cases) {
      for (const [sw, sh, dw, dh] of [[800, 600, 400, 500], [1000, 1000, 300, 900], [640, 480, 640, 480]]) {
        for (const [sx, sy] of [[0, 0], [sw / 2, sh / 2], [sw, sh], [sw * 0.3, sh * 0.8]]) {
          const [dx, dy] = framePoint(sx, sy, sw, sh, dw, dh, framing);
          const [bx, by] = unframePoint(dx, dy, sw, sh, dw, dh, framing);
          expect(bx).toBeCloseTo(sx, 6);
          expect(by).toBeCloseTo(sy, 6);
        }
      }
    }
  });

  it('puts the middle of an untouched frame at the middle of the picture', () => {
    expect(unframePoint(200, 250, 800, 600, 400, 500, DEFAULT_FRAMING)).toEqual([400, 300]);
  });

  it('answers OUTSIDE the picture for a point the crop cut away', () => {
    // A zoomed crop shows less than the whole picture, so a corner of the frame
    // is inside it — but with bars (contain) the corner is outside, and the
    // caller needs to be able to tell rather than being handed a clamp.
    const [x, y] = unframePoint(0, 0, 800, 600, 400, 500, { ...DEFAULT_FRAMING, fit: 'contain' });
    expect(x < 0 || y < 0).toBe(true);
  });
});
