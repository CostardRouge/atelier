import { describe, expect, it } from 'vitest';
import { recordingContext } from '../story/recording-context';
import { createTripDoc, createTripPlace, createTripStage } from '../roadtrip/trip-types';
import type { RecapPicture } from './recap-doc';
import { pickedOf, planTripOpener, tripCovering } from './recap-trip-opener';

const pic = (key: string, day: string, lat?: number, lon?: number): RecapPicture => ({ key, origin: 'local', name: `${key}.jpg`, kind: 'photo', day, minute: 600, ...(lat !== undefined ? { lat, lon } : {}) });

const trip = () => {
  const t = createTripDoc('West coast', '2026-10-01', '2026-10-20');
  t.stages = [
    createTripStage('South', 'Western Australia', '2026-10-01', '2026-10-10', [createTripPlace('Albany', 'WA', { lat: -35.02, lon: 117.88 }), createTripPlace('Esperance', 'WA', { lat: -33.86, lon: 121.89 })]),
    createTripStage('North', 'Western Australia', '2026-10-11', '2026-10-20', [createTripPlace('Perth', 'WA', { lat: -31.95, lon: 115.86 })]),
  ];
  return t;
};

describe('a trip opener at the head of a recap', () => {
  it('finds the trip covering the most of the recap’s days, none when none does', () => {
    const a = trip();
    const b = createTripDoc('Before', '2026-09-01', '2026-10-02');
    expect(tripCovering([b, a], ['2026-10-01', '2026-10-15'])?.name).toBe('West coast');
    expect(tripCovering([a], ['2025-01-01', '2025-01-31'])).toBeNull();
    expect(tripCovering([a], [])).toBeNull();
  });

  it('reads a recap picture as one of Trips’ picked pictures, found again by its key', () => {
    expect(pickedOf(pic('w:nas:4', '2026-10-03', -35, 118))).toMatchObject({ ref: { assetId: 'w:nas:4' }, date: '2026-10-03', coords: { lat: -35, lon: 118 } });
    expect(pickedOf({ ...pic('x', '2026-10-03'), day: null })).toBeNull();
  });

  it('runs Virée and Itinerary over the recap’s located pictures, painting a frame', () => {
    const pics = [pic('a', '2026-10-02', -35.02, 117.88), pic('b', '2026-10-06', -33.86, 121.89), pic('c', '2026-10-15', -31.95, 115.86), pic('d', '2026-11-30', -30, 115)];
    for (const kind of ['drive', 'map'] as const) {
      const plan = planTripOpener(kind, trip(), pics, '2026-10-31', 9 / 16);
      expect(plan, kind).not.toBeNull();
      expect(plan!.seconds).toBeGreaterThan(1);
      // A picture outside the trip is no stop.
      expect(plan!.keys).toEqual(['a', 'b', 'c']);
      expect(plan!.tripName).toBe('West coast');
      const rec = recordingContext(1080, 1920);
      plan!.paint(rec.ctx, 1080, 1920, plan!.seconds / 2, () => ({ image: {} as CanvasImageSource, width: 100, height: 100 }));
      expect(rec.ops.length).toBeGreaterThan(5);
    }
  });
});
