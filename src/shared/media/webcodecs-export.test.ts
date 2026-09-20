import { describe, expect, it, vi } from 'vitest';
import {
  deriveBitrate,
  drawRotatedFrame,
  rotationFromMatrix,
  trimWindow,
  type TrimSample,
} from './webcodecs-export';

describe('deriveBitrate', () => {
  it('spends half again as much on a GRAINED clip, and never under the floor', () => {
    const plain = deriveBitrate(1920, 1080, 30);
    const grained = deriveBitrate(1920, 1080, 30, true);
    // Film grain is a new, uncorrelated field every frame: there is nothing
    // for a P-frame to predict, so the budget tuned for smooth footage turns
    // the grain the stock asked for into blocking.
    expect(grained / plain).toBeCloseTo(0.18 / 0.12, 6);
    expect(deriveBitrate(1920, 1080, 30, false)).toBe(plain);
    // The floor holds either way — a postage stamp still gets 2 Mbps.
    expect(deriveBitrate(64, 64, 24, true)).toBe(2_000_000);
  });
});

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
      leadMicros: 0,
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

  it('cuts on the author\'s clock when the samples start late (B-frames)', () => {
    // ffmpeg's layout at 10 fps: presented 0.2 s late (an edit list mp4box
    // ignores), and a P-frame decoded ahead of the two B-frames shown before it.
    const order = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8, 12, 10, 11];
    const bframed: TrimSample[] = order.map((f, i) => ({
      cts: 200 + f * 100,
      duration: 100,
      timescale: 1000,
      is_sync: i === 0,
    }));
    // In at 0.4 s, out at 1 s: frames 4..9, six of them, as the <video> shows.
    const win = trimWindow(bframed, { start: 0.4, end: 1 });
    expect(win.leadMicros).toBe(200_000);
    expect(win.baseMicros).toBe(600_000);
    expect(win.endMicros).toBe(1_199_500);
    expect(win.frameCount).toBe(6);
    // Frame 9 is sample #7; frames 7 and 8 come after it but reference it.
    expect(win.decodeTo).toBe(9);
  });

  it('ignores µs rounding on the edges of a 60 fps clip', () => {
    // 256 ticks at 15360: 16 666.67 µs a frame, rounded both ways by toMicros.
    const sixty: TrimSample[] = Array.from({ length: 300 }, (_, i) => ({
      cts: i * 256,
      duration: 256,
      timescale: 15360,
      is_sync: i % 60 === 0,
    }));
    expect(trimWindow(sixty, { start: 1, end: 4 }).frameCount).toBe(180);
    expect(trimWindow(sixty, { start: 1 / 3, end: 3 + 1 / 3 }).frameCount).toBe(180);
  });

  it('rebases an untrimmed B-framed clip on its first presented frame', () => {
    const late = samples(5).map((s) => ({ ...s, cts: s.cts + 200 }));
    const win = trimWindow(late, null);
    expect(win.baseMicros).toBe(200_000);
    expect(win.leadMicros).toBe(200_000);
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
