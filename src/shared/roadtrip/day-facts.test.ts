import { describe, expect, it } from 'vitest';
import { dayFacts, placeOfDay, roadKmOnDay } from './day-facts';
import { encodeTrack } from './road-track';
import { createTripDoc, createTripPlace, createTripPost, createTripStage } from './trip-types';

function trip() {
  const doc = createTripDoc('Australia', '2026-01-01', '2026-01-10');
  const sydney = createTripPlace('Sydney', 'NSW', { lat: -33.87, lon: 151.21 }, { arrived: '2026-01-01', left: '2026-01-03' });
  const canberra = createTripPlace('Canberra', 'ACT', { lat: -35.28, lon: 149.13 }, { arrived: '2026-01-04', left: '2026-01-05' });
  const nowhere = createTripPlace('Nowhere', '', null);
  doc.stages = [createTripStage('East coast', 'NSW', '2026-01-01', '2026-01-05', [nowhere, sydney, canberra])];
  doc.posts = [createTripPost('photo', '2026-01-02', 'Harbour'), createTripPost('carousel', '2026-01-04', '', '2026-01-05')];
  return doc;
}

describe('dayFacts', () => {
  it('tells the day number, the leg, the dated place, the vehicle, the pieces and the sun on the longitude’s clock', () => {
    const f = dayFacts(trip(), '2026-01-02');
    expect(f.dayNumber).toBe(2);
    expect(f.totalDays).toBe(10);
    expect(f.stage).toMatchObject({ name: 'East coast', dayInStage: 2, places: ['Nowhere', 'Sydney', 'Canberra'] });
    expect(f.place).toEqual({ name: 'Sydney', lat: -33.87, lon: 151.21 });
    expect(f.vehicle).toMatchObject({ model: 'prado-j120' });
    expect(f.roadKm).toBeNull();
    expect(f.sun).toMatchObject({ zone: 'longitude', offsetMin: 600 });
    expect(f.sun?.sunrise).toMatch(/^0[45]:\d\d$/);
    expect(f.pieces).toEqual([{ id: expect.any(String), kind: 'photo', title: 'Harbour', published: false }]);
  });

  it('takes a given zone, finds the place dated for the day, and counts a spanning piece', () => {
    const f = dayFacts(trip(), '2026-01-04', 660);
    expect(f.place?.name).toBe('Canberra');
    expect(f.sun?.zone).toBe('given');
    expect(f.pieces.map((p) => p.kind)).toEqual(['carousel']);
  });

  it('says nothing of a day outside the trip or its legs', () => {
    const f = dayFacts(trip(), '2026-01-08');
    expect(f.stage).toBeNull();
    expect(f.place).toBeNull();
    expect(f.sun).toBeNull();
    expect(dayFacts(trip(), '2027-01-01').dayNumber).toBeNull();
  });

  it('falls back to a stage’s first located place', () => {
    const doc = trip();
    expect(placeOfDay(doc.stages[0], '2026-01-01')?.name).toBe('Sydney');
    expect(placeOfDay(doc.stages[0], '2026-01-05')?.name).toBe('Canberra');
  });
});

describe('roadKmOnDay', () => {
  it('sums the road’s fixes of the day in the zone given, and nothing across days', () => {
    const t0 = Date.UTC(2026, 0, 2, 0, 0, 0) / 1000; // 10:00 on 2 January at +10
    const fixes = [
      { t: t0, lat: -33.87, lon: 151.21 },
      { t: t0 + 3600, lat: -33.87, lon: 151.31 }, // ~9.2 km east
      { t: t0 + 7200, lat: -33.87, lon: 151.41 },
      { t: t0 + 86_400, lat: -34.87, lon: 151.41 }, // the next day
    ];
    const doc = { road: { track: encodeTrack(fixes) } } as never;
    expect(roadKmOnDay(doc, '2026-01-02', 600)).toBeCloseTo(18.4, 0);
    expect(roadKmOnDay(doc, '2026-01-03', 600)).toBe(0);
    expect(roadKmOnDay({ road: null }, '2026-01-02', 600)).toBeNull();
  });
});
