import { describe, expect, it } from 'vitest';
import {
  PLACE_ARROW,
  formatCoords,
  placeRegionLabel,
  stageEnd,
  stageLabel,
  stageRegionLabel,
  stageStart,
  tripRouteLabel,
} from './trip-places';
import {
  createTripDoc,
  createTripPlace,
  createTripStage,
  type TripPlace,
  type TripStage,
} from './trip-types';

function stage(name: string, places: TripPlace[], region = ''): TripStage {
  return createTripStage(name, region, '2025-11-02', '2025-11-20', places);
}

describe('stageStart / stageEnd', () => {
  it('are null when the stage names no place', () => {
    const s = stage('', []);
    expect(stageStart(s)).toBeNull();
    expect(stageEnd(s)).toBeNull();
  });

  it('are the SAME place when there is one — you did not go anywhere', () => {
    const s = stage('', [createTripPlace('Kalbarri')]);
    expect(stageStart(s)?.name).toBe('Kalbarri');
    expect(stageEnd(s)?.id).toBe(stageStart(s)?.id);
  });

  it('are the first and last of the order the leg was lived', () => {
    const s = stage('', [
      createTripPlace('Perth'),
      createTripPlace('Kalbarri'),
      createTripPlace('Exmouth'),
    ]);
    expect(stageStart(s)?.name).toBe('Perth');
    expect(stageEnd(s)?.name).toBe('Exmouth');
  });

  it('skips a row someone started but never named', () => {
    const s = stage('', [
      createTripPlace('   '),
      createTripPlace('Perth'),
      createTripPlace(''),
    ]);
    expect(stageStart(s)?.name).toBe('Perth');
    expect(stageEnd(s)?.name).toBe('Perth');
  });
});

describe('stageLabel', () => {
  it('is empty when the stage names nothing — the caller must fall back', () => {
    expect(stageLabel(stage('', []))).toBe('');
  });

  it('derives one name from one place', () => {
    expect(stageLabel(stage('', [createTripPlace('Kalbarri')]))).toBe('Kalbarri');
  });

  it('derives the two ends of a leg, ignoring what is between them', () => {
    const s = stage('', [
      createTripPlace('Perth'),
      createTripPlace('Kalbarri'),
      createTripPlace('Cairns'),
    ]);
    expect(stageLabel(s)).toBe(`Perth ${PLACE_ARROW} Cairns`);
  });

  it("uses a geometric arrow, never an emoji — it is drawn on a canvas", () => {
    // The measured trap: 📍 drew nothing at all where no colour-emoji font
    // existed. Anything here must be monochrome and present everywhere.
    expect(PLACE_ARROW).toBe('→');
  });

  it("the author's own name always wins over the derivation", () => {
    const s = stage('The Red Centre', [
      createTripPlace('Alice Springs'),
      createTripPlace('Uluru'),
    ]);
    expect(stageLabel(s)).toBe('The Red Centre');
  });

  it('clearing that name gives the derived label back, never a blank', () => {
    const s = stage('   ', [createTripPlace('Perth'), createTripPlace('Cairns')]);
    expect(stageLabel(s)).toBe(`Perth ${PLACE_ARROW} Cairns`);
  });
});

describe('stageRegionLabel', () => {
  it("prefers the stage's own region", () => {
    const s = stage('', [createTripPlace('Perth', 'Somewhere else')], 'Western Australia');
    expect(stageRegionLabel(s)).toBe('Western Australia');
  });

  it('falls back to the region its places agree on', () => {
    const s = stage('', [
      createTripPlace('Perth', 'Western Australia'),
      createTripPlace('Kalbarri', 'Western Australia'),
    ]);
    expect(stageRegionLabel(s)).toBe('Western Australia');
  });

  it('says nothing when they disagree, rather than picking one', () => {
    const s = stage('', [
      createTripPlace('Perth', 'Western Australia'),
      createTripPlace('Cairns', 'Queensland'),
    ]);
    expect(stageRegionLabel(s)).toBe('');
  });

  it('is empty when nothing carries a region', () => {
    expect(stageRegionLabel(stage('', [createTripPlace('Perth')]))).toBe('');
  });
});

describe('placeRegionLabel', () => {
  it("falls back to the stage's region, so an empty field is never blank", () => {
    const place = createTripPlace('Kalbarri');
    const s = stage('', [place], 'Western Australia');
    expect(placeRegionLabel(place, s)).toBe('Western Australia');
  });

  it("keeps the place's own when it has one", () => {
    const place = createTripPlace('Cairns', 'Queensland');
    const s = stage('', [place], 'Western Australia');
    expect(placeRegionLabel(place, s)).toBe('Queensland');
  });
});

describe('tripRouteLabel', () => {
  const dates = ['2025-11-02', '2026-02-14'] as const;

  it('is empty for a trip with no stage', () => {
    expect(tripRouteLabel(createTripDoc('Australie', '', ...dates))).toBe('');
  });

  it('runs from the first place of the first stage to the last of the last', () => {
    const trip = createTripDoc('Australie', '', ...dates);
    trip.stages = [
      createTripStage('', '', '2025-11-02', '2025-11-20', [
        createTripPlace('Perth'),
        createTripPlace('Kalbarri'),
      ]),
      createTripStage('', '', '2025-11-21', '2026-02-14', [
        createTripPlace('Darwin'),
        createTripPlace('Cairns'),
      ]),
    ];
    expect(tripRouteLabel(trip)).toBe(`Perth ${PLACE_ARROW} Cairns`);
  });

  it('steps over a stage that names nothing rather than losing an end', () => {
    const trip = createTripDoc('Australie', '', ...dates);
    trip.stages = [
      createTripStage('', '', '2025-11-02', '2025-11-20', [createTripPlace('Perth')]),
      createTripStage('Driving', '', '2025-11-21', '2025-12-01', []),
      createTripStage('', '', '2025-12-02', '2026-02-14', [createTripPlace('Cairns')]),
    ];
    expect(tripRouteLabel(trip)).toBe(`Perth ${PLACE_ARROW} Cairns`);
  });
});

describe('formatCoords', () => {
  it('is empty for a place that is only a name', () => {
    expect(formatCoords(null)).toBe('');
  });

  it('keeps six decimals and the sign, as the EXIF reader writes them', () => {
    expect(formatCoords({ lat: -27.7099, lon: 114.165 })).toBe('-27.709900, 114.165000');
  });
});
