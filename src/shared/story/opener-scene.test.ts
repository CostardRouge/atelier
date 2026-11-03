import { afterEach, describe, expect, it } from 'vitest';
import { createTripDoc, type TripDoc } from '../roadtrip/trip-types';
import { recordingContext, RecordingPath2D } from './recording-context';
import { openerClock, openerRender, paintStoryOpener, setOpenerScene, setOpenerTrip, storyOpenerReady } from './opener-scene';

function trip(): TripDoc {
  const t = createTripDoc('Australia', '2025-03-01', '2025-03-10');
  const place = (id: string, name: string, lat: number, lon: number) => ({ id, name, state: '', coords: { lat, lon } });
  t.stages = [
    { id: 's1', name: 'East', region: '', startDate: '2025-03-01', endDate: '2025-03-05', places: [place('a', 'Sydney', -33.87, 151.21), place('b', 'Byron Bay', -28.64, 153.61)] },
    { id: 's2', name: 'North', region: '', startDate: '2025-03-06', endDate: '2025-03-10', places: [place('c', 'Brisbane', -27.47, 153.03), place('d', 'Noosa', -26.39, 153.09)] },
  ] as TripDoc['stages'];
  return t;
}

describe('openerClock', () => {
  it('plays at its own pace, sped up only to end within the scene, then held', () => {
    expect(openerClock(1, 4, 6)).toBe(1);
    expect(openerClock(5, 4, 6)).toBeCloseTo(4 - 1e-3);
    expect(openerClock(3, 12, 6)).toBe(6);
    expect(openerClock(1, 0, 6)).toBe(0);
  });
});

describe('Trips’ openers as a map scene', () => {
  afterEach(() => setOpenerTrip(null));
  it('cannot run without the trip: the series’ map draws', () => {
    setOpenerTrip(null);
    expect(storyOpenerReady('map')).toBe(false);
    expect(paintStoryOpener(recordingContext().ctx, 1, 'map')).toBe(false);
  });
  it('the Itinerary and Virée prepare on the trip and paint its places', () => {
    const P = globalThis.Path2D;
    if (typeof P === 'undefined') (globalThis as { Path2D?: unknown }).Path2D = RecordingPath2D;
    try {
      setOpenerTrip(trip(), '2025-03-01');
      setOpenerScene(6);
      for (const id of ['map', 'drive'] as const) {
        const render = openerRender(id, undefined, 6);
        expect(render?.seconds).toBeGreaterThan(0);
        const rec = recordingContext();
        expect(paintStoryOpener(rec.ctx, 2, id)).toBe(true);
        expect(rec.ops.length).toBeGreaterThan(10);
        // Prepared once for the scene: the same closure on the next frame.
        expect(openerRender(id, undefined, 6)).toBe(render);
      }
    } finally {
      if (typeof P === 'undefined') delete (globalThis as { Path2D?: unknown }).Path2D;
    }
  });
});
