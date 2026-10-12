import { describe, expect, it } from 'vitest';
import { buildCameraTrack, cameraAt, driftView, fitView, invertAffine, panView, viewAffine, visibleBox, zoomViewAbout } from './atlas-view';

const flat = { bearing: 0, tilt: 1 };
const box = { x0: 0.8, y0: 0.59, x1: 0.802, y1: 0.591 };

describe('the view', () => {
  it('fits a box inside the frame with its margin, whatever unit the frame is in', () => {
    for (const [w, h] of [
      [16 / 9, 1],
      [1920, 1080],
    ]) {
      const v = fitView(box, flat, w, h, 0.1);
      const m = viewAffine(v, flat, w, h);
      const sx0 = m.a * box.x0 + m.e;
      const sx1 = m.a * box.x1 + m.e;
      const sy0 = m.d * box.y0 + m.f;
      const sy1 = m.d * box.y1 + m.f;
      const pad = 0.1 * Math.min(w, h);
      expect(sx0).toBeGreaterThanOrEqual(pad - 1e-6);
      expect(sx1).toBeLessThanOrEqual(w - pad + 1e-6);
      expect(sy0).toBeGreaterThanOrEqual(pad - 1e-6);
      expect(sy1).toBeLessThanOrEqual(h - pad + 1e-6);
      // It is tight on one axis.
      expect(Math.min(sx0 - pad, sy0 - pad)).toBeLessThan(1e-3 * Math.min(w, h));
    }
  });

  it('the same normalised view draws the same picture at any size', () => {
    const v = fitView(box, flat, 16 / 9, 1);
    const a = viewAffine(v, flat, 1920, 1080);
    const b = viewAffine(v, flat, 960, 540);
    expect(a.a * box.x1 + a.e).toBeCloseTo(2 * (b.a * box.x1 + b.e), 6);
  });

  it('inverts its affine, turned and tilted', () => {
    const look = { bearing: 33, tilt: 0.6 };
    const m = viewAffine({ cx: 0.3, cy: 0.4, scale: 900 }, look, 800, 600);
    const inv = invertAffine(m);
    const sx = m.a * 0.3005 + m.c * 0.4002 + m.e;
    const sy = m.b * 0.3005 + m.d * 0.4002 + m.f;
    expect(inv.a * sx + inv.c * sy + inv.e).toBeCloseTo(0.3005, 12);
    expect(inv.b * sx + inv.d * sy + inv.f).toBeCloseTo(0.4002, 12);
  });

  it('zooms about a point, keeping it still', () => {
    const v = fitView(box, flat, 800, 600);
    const m0 = viewAffine(v, flat, 800, 600);
    const w0 = invertAffine(m0);
    const wx = w0.a * 200 + w0.c * 150 + w0.e;
    const wy = w0.b * 200 + w0.d * 150 + w0.f;
    const z = zoomViewAbout(v, flat, 800, 600, 2, 200, 150);
    expect(z.scale).toBeCloseTo(v.scale * 2, 6);
    const m1 = viewAffine(z, flat, 800, 600);
    expect(m1.a * wx + m1.c * wy + m1.e).toBeCloseTo(200, 6);
    expect(m1.b * wx + m1.d * wy + m1.f).toBeCloseTo(150, 6);
  });

  it('pans with the hand and shows the box it frames', () => {
    const v = { cx: 0.5, cy: 0.5, scale: 2 };
    const p = panView(v, flat, 100, 100, 10, 0);
    expect(p.cx).toBeLessThan(0.5);
    const b = visibleBox(v, flat, 100, 100);
    expect(b.x0).toBeCloseTo(0.25, 9);
    expect(b.x1).toBeCloseTo(0.75, 9);
  });

  it('drifts by zoom steps over the animation', () => {
    const v = { cx: 0.5, cy: 0.5, scale: 100 };
    expect(driftView(v, 1, 1).scale).toBeCloseTo(200, 9);
    expect(driftView(v, 1, 0).scale).toBe(100);
  });
});

describe('the follow camera', () => {
  it('ends on the target, and pulls out to travel far', () => {
    const a = { x0: 0.1, y0: 0.4, x1: 0.1001, y1: 0.4001 };
    const b = { x0: 0.9, y0: 0.6, x1: 0.9001, y1: 0.6001 };
    const track = buildCameraTrack((t) => (t < 5 ? a : b), 20, flat, 16 / 9, 1, 0.1, 0.8);
    const start = cameraAt(track, 0);
    const mid = cameraAt(track, 6);
    const end = cameraAt(track, 20);
    expect(start.cx).toBeCloseTo(0.10005, 6);
    expect(end.cx).toBeCloseTo(0.90005, 4);
    expect(mid.scale).toBeLessThan(start.scale / 10);
    // Deterministic: a function of time.
    expect(cameraAt(track, 6.5)).toEqual(cameraAt(track, 6.5));
  });
});
