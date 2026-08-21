import { describe, expect, it, vi } from 'vitest';
import {
  drawRotatedFrame,
  rotationFromMatrix,
  trimWindow,
  type TrimSample,
} from './webcodecs-export';

describe('rotationFromMatrix', () => {
  // tkhd matrices are read via atan2(b, a) on the first two entries.
  it('reads 0° from the identity matrix', () => {
    expect(rotationFromMatrix([1, 0])).toBe(0);
  });
  it('reads 90° clockwise', () => {
    expect(rotationFromMatrix([0, 1])).toBe(90);
  });
  it('reads 180°', () => {
    expect(rotationFromMatrix([-1, 0])).toBe(180);
  });
  it('reads 270°', () => {
    expect(rotationFromMatrix([0, -1])).toBe(270);
  });
  it('defaults to 0 for a degenerate/absent matrix', () => {
    expect(rotationFromMatrix(undefined)).toBe(0);
    expect(rotationFromMatrix([0, 0])).toBe(0);
  });
});

/** 10 fps in a 1000-tick timescale, a keyframe every 10 samples. */
function samples(count: number, gop = 10): TrimSample[] {
  return Array.from({ length: count }, (_, i) => ({
    cts: i * 100,
    duration: 100,
    timescale: 1000,
    is_sync: i % gop === 0,
  }));
}

describe('trimWindow', () => {
  it('passes the whole file through when nothing is trimmed', () => {
    expect(trimWindow(samples(30), null)).toEqual({
      decodeFrom: 0,
      decodeTo: 29,
      baseMicros: 0,
      endMicros: Number.POSITIVE_INFINITY,
      frameCount: 30,
    });
  });

  it('starts decoding at the keyframe before the in point', () => {
    // In at 1.25 s: the frame covering it is #12, its keyframe is #10.
    const win = trimWindow(samples(30), { start: 1.25, end: 2 });
    expect(win.decodeFrom).toBe(10);
    expect(win.baseMicros).toBe(1_200_000);
    expect(win.decodeTo).toBe(19);
    expect(win.frameCount).toBe(8);
  });

  it('rebases on the frame under the in handle, not on the handle itself', () => {
    // The preview shows frame #12 at 1.25 s, so the export must open on it.
    const win = trimWindow(samples(30), { start: 1.25, end: 2 });
    expect(win.baseMicros).toBeLessThanOrEqual(1_250_000);
    expect(win.baseMicros + 100_000).toBeGreaterThan(1_250_000);
  });

  it('decodes far enough for frames presented late in decode order', () => {
    // A B-pyramid: #2 is presented after #3. Trimming just past #3 must still
    // pull in #2 — and nothing beyond, since references are always earlier.
    const reordered: TrimSample[] = [
      { cts: 0, duration: 100, timescale: 1000, is_sync: true },
      { cts: 100, duration: 100, timescale: 1000, is_sync: false },
      { cts: 300, duration: 100, timescale: 1000, is_sync: false },
      { cts: 200, duration: 100, timescale: 1000, is_sync: false },
      { cts: 400, duration: 100, timescale: 1000, is_sync: false },
    ];
    const win = trimWindow(reordered, { start: 0, end: 0.4 });
    expect(win.decodeTo).toBe(3);
    expect(win.frameCount).toBe(4);
  });

  it('keeps at least one frame when the range collapses onto the last one', () => {
    const win = trimWindow(samples(5), { start: 4.9, end: 5 });
    expect(win.decodeFrom).toBe(0);
    expect(win.frameCount).toBe(1);
  });
});

/** A recording stand-in for the bits of a 2D context drawRotatedFrame uses. */
function stubCtx() {
  const calls: string[] = [];
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    translate: vi.fn((x: number, y: number) => calls.push(`translate(${x},${y})`)),
    rotate: vi.fn((a: number) => calls.push(`rotate(${a.toFixed(4)})`)),
    drawImage: vi.fn((_s: unknown, x: number, y: number, w: number, h: number) =>
      calls.push(`drawImage(${x},${y},${w},${h})`),
    ),
  };
  return { ctx, calls };
}

const SRC = {} as CanvasImageSource;
const HALF_PI = (Math.PI / 2).toFixed(4);
const PI = Math.PI.toFixed(4);
const THREE_HALF_PI = ((3 * Math.PI) / 2).toFixed(4);

describe('drawRotatedFrame', () => {
  it('draws upright with no transform for 0°', () => {
    const { ctx, calls } = stubCtx();
    drawRotatedFrame(ctx as unknown as CanvasRenderingContext2D, SRC, 1920, 1080, 0, 1920, 1080);
    expect(calls).toEqual(['save', 'drawImage(0,0,1920,1080)', 'restore']);
  });

  it('rotates 90° and uses swapped output dimensions', () => {
    const { ctx, calls } = stubCtx();
    drawRotatedFrame(ctx as unknown as CanvasRenderingContext2D, SRC, 1920, 1080, 90, 1080, 1920);
    expect(calls).toEqual([
      'save',
      'translate(1080,0)',
      `rotate(${HALF_PI})`,
      'drawImage(0,0,1920,1080)',
      'restore',
    ]);
  });

  it('rotates 180° in place', () => {
    const { ctx, calls } = stubCtx();
    drawRotatedFrame(ctx as unknown as CanvasRenderingContext2D, SRC, 1920, 1080, 180, 1920, 1080);
    expect(calls).toEqual([
      'save',
      'translate(1920,1080)',
      `rotate(${PI})`,
      'drawImage(0,0,1920,1080)',
      'restore',
    ]);
  });

  it('rotates 270° with swapped output dimensions', () => {
    const { ctx, calls } = stubCtx();
    drawRotatedFrame(ctx as unknown as CanvasRenderingContext2D, SRC, 1920, 1080, 270, 1080, 1920);
    expect(calls).toEqual([
      'save',
      'translate(0,1920)',
      `rotate(${THREE_HALF_PI})`,
      'drawImage(0,0,1920,1080)',
      'restore',
    ]);
  });
});
