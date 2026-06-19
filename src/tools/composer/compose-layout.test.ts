import { describe, expect, it } from 'vitest';
import { even, fitRect, outputSize, paneRects } from './compose-layout';

describe('even / outputSize', () => {
  it('rounds to even', () => {
    expect(even(1080)).toBe(1080);
    expect(even(1083)).toBe(1084);
    expect(even(607)).toBe(608);
  });

  it('derives output size from aspect and long edge', () => {
    expect(outputSize(16, 9, 1920)).toEqual({ w: 1920, h: 1080 });
    expect(outputSize(9, 16, 1920)).toEqual({ w: 1080, h: 1920 });
    expect(outputSize(1, 1, 1080)).toEqual({ w: 1080, h: 1080 });
  });
});

describe('paneRects', () => {
  it('splits side-by-side by the video fraction', () => {
    const r = paneRects(1000, 500, 'side-by-side', 0.6, 0.3, 'br');
    expect(r.video).toEqual({ x: 0, y: 0, w: 600, h: 500 });
    expect(r.map).toEqual({ x: 600, y: 0, w: 400, h: 500 });
  });

  it('splits stacked by the video fraction', () => {
    const r = paneRects(800, 1000, 'stacked', 0.5, 0.3, 'br');
    expect(r.video).toEqual({ x: 0, y: 0, w: 800, h: 500 });
    expect(r.map).toEqual({ x: 0, y: 500, w: 800, h: 500 });
  });

  it('clamps an extreme split', () => {
    const r = paneRects(1000, 500, 'side-by-side', 0.99, 0.3, 'br');
    expect(r.video.w).toBe(900); // clamped to 0.9
  });

  it('insets the map pip into a corner over the full video', () => {
    const r = paneRects(1000, 1000, 'pip-map', 0.5, 0.25, 'br');
    expect(r.video).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
    expect(r.map.w).toBe(250);
    expect(r.map.h).toBe(250);
    const margin = 30; // round(1000 * 0.03)
    expect(r.map.x).toBe(1000 - 250 - margin);
    expect(r.map.y).toBe(1000 - 250 - margin);
  });

  it('pip-video swaps which pane is full', () => {
    const r = paneRects(1000, 1000, 'pip-video', 0.5, 0.25, 'tl');
    expect(r.map).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
    expect(r.video.x).toBe(30);
    expect(r.video.y).toBe(30);
  });
});

describe('fitRect', () => {
  const dst = { x: 0, y: 0, w: 100, h: 100 };

  it('cover crops a wide source to a square pane', () => {
    const r = fitRect(200, 100, dst, 'cover');
    expect(r.sw).toBe(100); // crop width to match square
    expect(r.sh).toBe(100);
    expect(r.sx).toBe(50); // centred crop
    expect(r.dw).toBe(100);
    expect(r.dh).toBe(100);
  });

  it('contain letterboxes a wide source inside a square pane', () => {
    const r = fitRect(200, 100, dst, 'contain');
    expect(r.dw).toBe(100);
    expect(r.dh).toBe(50);
    expect(r.dy).toBe(25); // vertically centred bars
    expect(r.sx).toBe(0);
    expect(r.sw).toBe(200);
  });
});
