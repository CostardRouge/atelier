import { describe, expect, it, vi } from 'vitest';
import { drawRotatedFrame, rotationFromMatrix } from './webcodecs-export';

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
