import { describe, expect, it } from 'vitest';
import type { AtlasFlight } from './atlas-flight';
import { FOOT_LAYERS, hitAt, LAYERS, layerInfo, nearFlight, parseLayer, unionOf, type OverlayHit } from './atlas-layers';

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function line(xs: number[], ys: number[]): AtlasFlight {
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys) } as unknown as AtlasFlight;
}

describe('layers', () => {
  it('names every layer once, the drawn ones apart from the foot', () => {
    const ids = [...LAYERS, ...FOOT_LAYERS].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(layerInfo('sticker').label).toBe('Sticker');
  });

  it('reads back a stored layer, and opens on the map for anything else', () => {
    expect(parseLayer('clock')).toBe('clock');
    expect(parseLayer('overlay')).toBe('map');
    expect(parseLayer(null)).toBe('map');
  });
});

describe('hitAt', () => {
  const hits: OverlayHit[] = [
    { layer: 'title', x: 10, y: 10, w: 100, h: 40 },
    { layer: 'sticker', x: 90, y: 30, w: 60, h: 20 },
  ];

  it('finds the box under the point, the last drawn first where two overlap', () => {
    expect(hitAt(hits, 20, 20)).toBe('title');
    expect(hitAt(hits, 100, 40)).toBe('sticker');
    expect(hitAt(hits, 300, 300)).toBeNull();
  });

  it('reaches a little past a box when asked', () => {
    expect(hitAt(hits, 5, 5)).toBeNull();
    expect(hitAt(hits, 5, 5, 6)).toBe('title');
  });
});

describe('unionOf', () => {
  it('boxes every piece of one layer, and nothing for a layer not drawn', () => {
    const hits: OverlayHit[] = [
      { layer: 'clock', x: 10, y: 50, w: 20, h: 10 },
      { layer: 'title', x: 0, y: 0, w: 5, h: 5 },
      { layer: 'clock', x: 40, y: 20, w: 10, h: 10 },
    ];
    expect(unionOf(hits, 'clock')).toEqual({ x: 10, y: 20, w: 40, h: 40 });
    expect(unionOf(hits, 'stats')).toBeNull();
  });
});

describe('nearFlight', () => {
  const flights = [line([0, 100], [0, 0]), line([200], [200])];

  it('answers within the radius of a segment, not only of its fixes', () => {
    expect(nearFlight(flights, IDENTITY, 50, 4, 5)).toBe(true);
    expect(nearFlight(flights, IDENTITY, 50, 9, 5)).toBe(false);
  });

  it('counts a single fix as a point', () => {
    expect(nearFlight(flights, IDENTITY, 203, 203, 5)).toBe(true);
  });

  it('projects through the view', () => {
    const doubled = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 10 };
    expect(nearFlight([line([0, 10], [0, 0])], doubled, 25, 11, 2)).toBe(true);
    expect(nearFlight([line([0, 10], [0, 0])], doubled, 35, 11, 2)).toBe(false);
  });
});
