import { describe, expect, it } from 'vitest';
import { fitProjection, formatDistance, haversineKm, placeLabels, projectionFor } from './geo';

const PERTH = { lat: -31.95, lon: 115.86 };
const BROOME = { lat: -17.96, lon: 122.24 };

describe('projectionFor', () => {
  it('agrees with fitProjection about where a point lands', () => {
    const box = { x: 10, y: 20, width: 300, height: 500 };
    const fit = fitProjection([PERTH, BROOME], box);
    const p = projectionFor([PERTH, BROOME], box.width, box.height);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (const point of [PERTH, BROOME, { lat: -25, lon: 118 }]) {
      const a = fit(point);
      const b = p.at(point, cx, cy);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
    }
  });

  it('keeps its scale when re-centred — a camera that follows moves the view, not the map', () => {
    const p = projectionFor([PERTH, BROOME], 300, 500);
    const a = p.at(BROOME, 0, 0);
    const b = p.at(BROOME, 100, -40);
    expect(b.x - a.x).toBeCloseTo(100, 9);
    expect(b.y - a.y).toBeCloseTo(-40, 9);
  });

  it('has north up and east right', () => {
    const p = projectionFor([PERTH, BROOME], 300, 500);
    const perth = p.at(PERTH, 0, 0);
    const broome = p.at(BROOME, 0, 0);
    expect(broome.y).toBeLessThan(perth.y);
    expect(broome.x).toBeGreaterThan(perth.x);
  });

  it('takes the fallback scale for a single spot', () => {
    const p = projectionFor([PERTH], 300, 500, 42);
    expect(p.scale).toBe(42);
    expect(p.at(PERTH, 7, 9)).toEqual({ x: 7, y: 9 });
  });
});

describe('haversineKm / formatDistance', () => {
  it('measures Perth to Broome at about 1 680 km', () => {
    const km = haversineKm(PERTH, BROOME);
    expect(km).toBeGreaterThan(1650);
    expect(km).toBeLessThan(1720);
  });

  it('formats with a thin thousands space and one decimal under ten', () => {
    expect(formatDistance(1682.4, 'km')).toBe('1 682 km');
    expect(formatDistance(3.14159, 'km')).toBe('3.1 km');
    expect(formatDistance(100, 'mi')).toBe('62 mi');
    expect(formatDistance(100, 'off')).toBe('');
  });
});

describe('placeLabels', () => {
  const frame = { width: 400, height: 400 };

  it('places to the right first, then the left when the right leaves the frame', () => {
    const [near, edge] = placeLabels(
      [
        { x: 100, y: 100, name: 'Perth', wanted: true },
        { x: 395, y: 300, name: 'Broome', wanted: true },
      ],
      20,
      frame,
      4,
    );
    expect(near.side).toBe('right');
    expect(edge.side).toBe('left');
  });

  it('never puts a name inside a box the caller reserved', () => {
    const reserved = [{ x0: 100, y0: 60, x1: 260, y1: 140 }];
    const [label] = placeLabels([{ x: 100, y: 100, name: 'Perth', wanted: true }], 20, frame, 4, undefined, reserved);
    expect(label.side).toBe('left');
  });

  it('drops a name rather than drawing it over another', () => {
    const labels = placeLabels(
      [
        { x: 200, y: 200, name: 'Somewhere', wanted: true },
        { x: 201, y: 200, name: 'Elsewhere', wanted: true },
        { x: 202, y: 201, name: 'Nowhere', wanted: true },
        { x: 203, y: 199, name: 'Anywhere', wanted: true },
        { x: 200, y: 202, name: 'Everywhere', wanted: true },
      ],
      20,
      frame,
      4,
    );
    expect(labels.length).toBeLessThan(5);
    expect(new Set(labels.map((l) => l.side)).size).toBe(labels.length);
  });
});
