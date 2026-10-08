import { describe, expect, it } from 'vitest';
import type { HookDay, HookPickedPicture, HookStage } from './hook-variant';
import { ownStops, readStopSource, sourceStops } from './stop-source';
import { mapVariant } from './map';
import { driveOptions, driveRoute } from './drive-plan';

const STAGES: HookStage[] = [
  { startDate: '2025-03-01', endDate: '2025-03-05', label: '', places: [{ name: 'Perth', lat: -31.95, lon: 115.86, state: 'Western Australia', stateCode: 'WA' }, { name: 'Kalbarri', lat: -27.71, lon: 114.16 }] },
  { startDate: '2025-03-06', endDate: '2025-03-10', label: '', places: [{ name: 'Broome', lat: -17.96, lon: 122.24 }] },
];
const CAL: HookDay[] = Array.from({ length: 10 }, (_, i) => ({
  date: `2025-03-${String(i + 1).padStart(2, '0')}`,
  dayNumber: i + 1,
  told: false,
  legStart: i === 0 || i === 5,
  pieces: [],
}));
const ctx = { stages: STAGES, calendar: CAL, date: '2025-03-10' };
const pic = (name: string, date: string, coords?: { lat: number; lon: number }): HookPickedPicture => ({
  ref: { name, size: 1, lastModified: 0 },
  date,
  ...(coords ? { coords } : {}),
});

describe('where an opener’s stops come from', () => {
  it('the author’s own map, as it is', () => {
    const stops = [{ id: 'x', name: 'Here', lat: 1, lon: 2 }];
    expect(sourceStops({ stopsOn: 'custom', stops, picked: [], includePieces: true }, ctx)).toEqual(stops);
  });

  it('the legs: their located places up to the day, with what each place knows', () => {
    const stops = sourceStops({ stopsOn: 'places', stops: [], picked: [], includePieces: true }, ctx);
    expect(stops.map((s) => s.name)).toEqual(['Perth', 'Kalbarri', 'Broome']);
    expect(stops[0]).toMatchObject({ state: 'Western Australia', stateCode: 'WA', lat: -31.95 });
    expect(new Set(stops.map((s) => s.id)).size).toBe(3);
  });

  it('the photos: one stop per located picture, holding it', () => {
    const picked = [pic('a.jpg', '2025-03-02', { lat: -31.9, lon: 115.9 }), pic('b.jpg', '2025-03-08', { lat: -17.9, lon: 122.2 })];
    const stops = sourceStops({ stopsOn: 'pictures', stops: [], picked, includePieces: true }, ctx);
    expect(stops).toHaveLength(2);
    expect(stops.map((s) => s.picture?.ref.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('becomes the author’s own map once edited, with ids of its own', () => {
    const taken = sourceStops({ stopsOn: 'places', stops: [], picked: [], includePieces: true }, ctx);
    const own = ownStops('places', taken.slice(1));
    expect(own.stopsOn).toBe('custom');
    expect(own.stops?.map((s) => s.name)).toEqual(['Kalbarri', 'Broome']);
    expect(own.stops?.every((s) => s.id.startsWith('own-'))).toBe(true);
  });

  it('reads a stored itinerary as its own map, and a card as the legs', () => {
    expect(readStopSource({}, 'custom').stopsOn).toBe('custom');
    expect(readStopSource({ stopsOn: 'moon' }, 'places').stopsOn).toBe('places');
  });

  it('never gives a stop the picture it already holds twice', () => {
    const picture = pic('a.jpg', '2025-03-02', { lat: -31.9, lon: 115.9 });
    const o = driveOptions({ stopsOn: 'custom', stops: [{ id: 's', name: 'Perth', lat: -31.95, lon: 115.86, picture }, { id: 't', name: 'Broome', lat: -17.96, lon: 122.24 }], picked: [picture] });
    const route = driveRoute(STAGES, CAL, '2025-03-10', o);
    expect(route.stops[0].pictures.map((p) => p.key)).toEqual(['name:a.jpg:1']);
  });
});

describe('the Itinerary on the legs', () => {
  it('draws and asks for the pictures of the stops its source gives', () => {
    const picked = [pic('a.jpg', '2025-03-02', { lat: -31.9, lon: 115.9 })];
    const options = { ...mapVariant.defaults, stopsOn: 'places', picked };
    const full = { aspect: 1, durationSeconds: 2, content: null, ...ctx };
    expect(mapVariant.wantsPictures!(options, full).map((w) => w.key)).toEqual(['name:a.jpg:1']);
    expect(mapVariant.prepare(options, full).seconds).toBeGreaterThan(0);
    // A stored itinerary is its own map: nothing changes for it.
    expect(mapVariant.prepare({ ...mapVariant.defaults }, full).seconds).toBe(0);
  });
});
