import { describe, expect, it } from 'vitest';
import { locatePicture } from './locate-picture';
import type { GazetteerCity } from './gazetteer';
import { stageLabel } from './trip-places';
import {
  createTripDoc,
  createTripPlace,
  createTripStage,
  type TripDoc,
  type TripStage,
} from './trip-types';

const KALBARRI: GazetteerCity = {
  name: 'Kalbarri',
  country: 'AU',
  lat: -27.7105,
  lon: 114.165,
  population: 2602,
  section: false,
};

const PERTH: GazetteerCity = {
  name: 'Perth',
  country: 'AU',
  lat: -31.9522,
  lon: 115.8614,
  population: 1896548,
  section: false,
};

const CITIES = [KALBARRI, PERTH];

/** Where a picture taken at Kalbarri says it was. */
const AT_KALBARRI = { lat: -27.7098, lon: 114.1662 };

const trip = (stages: TripStage[] = []): TripDoc => ({
  ...createTripDoc('Australia', '2025-11-01', '2025-11-30'),
  stages,
});

const locate = (doc: TripDoc, date: string | null, coords = AT_KALBARRI as
  | { lat: number; lon: number }
  | null) => locatePicture({ trip: doc, date, coords, cities: CITIES });

describe('locatePicture — what it refuses', () => {
  it('says nothing about a picture whose EXIF holds no position', () => {
    const result = locate(trip(), '2025-11-03', null);
    expect(result.silence).toBe('no-position');
    expect(result.proposal).toBeNull();
    expect(result.city).toBeNull();
  });

  it('refuses Null Island, which is a camera with no fix', () => {
    const result = locate(trip(), '2025-11-03', { lat: 0, lon: 0 });
    expect(result.silence).toBe('null-island');
    expect(result.proposal).toBeNull();
  });

  it('refuses coordinates that are not on the globe', () => {
    expect(locate(trip(), '2025-11-03', { lat: 99, lon: 12 }).silence).toBe('no-position');
    expect(locate(trip(), '2025-11-03', { lat: Number.NaN, lon: 12 }).silence).toBe(
      'no-position',
    );
  });

  it('has no leg to offer to when nothing says which day the picture is', () => {
    const result = locate(trip(), null);
    expect(result.silence).toBe('no-date');
    // The name is still looked up: the author learns where it was even when
    // nothing can be written down.
    expect(result.city?.name).toBe('Kalbarri');
  });

  it('refuses a date that is not a calendar day rather than slicing one out', () => {
    expect(locate(trip(), '2025-11-03T07:14:00Z').silence).toBe('no-date');
    expect(locate(trip(), '2025-02-30').silence).toBe('no-date');
  });

  it('calls out a picture dated outside the trip instead of clamping it', () => {
    const result = locate(trip(), '2024-06-02');
    expect(result.silence).toBe('outside-trip');
    expect(result.date).toBe('2024-06-02');
    expect(result.proposal).toBeNull();
  });

  it('offers no place when nothing in the index is near enough to name one', () => {
    const middleOfNowhere = { lat: -31.5, lon: 128.9 };
    const result = locate(trip(), '2025-11-03', middleOfNowhere);
    expect(result.silence).toBe('no-name');
    expect(result.city).toBeNull();
  });

  it('says so when the leg of that day already names the place', () => {
    const stage = createTripStage('', '', '2025-11-02', '2025-11-06', [
      createTripPlace('Kalbarri', '', { lat: -27.7105, lon: 114.165 }),
    ]);
    const result = locate(trip([stage]), '2025-11-03');
    expect(result.silence).toBe('already');
    expect(result.proposal).toBeNull();
    expect(result.stage?.id).toBe(stage.id);
  });
});

describe('locatePicture — naming the leg of the day', () => {
  const nameless = () => createTripStage('', '', '2025-11-02', '2025-11-06');

  it('gives a leg that names nothing the picture’s place', () => {
    const stage = nameless();
    const doc = trip([stage]);
    const result = locate(doc, '2025-11-03');

    expect(result.silence).toBeNull();
    expect(result.proposal?.id).toBe('name');
    expect(result.proposal?.label).toContain('Kalbarri');

    const { stages, selectedId } = result.proposal!.apply(doc);
    expect(selectedId).toBe(stage.id);
    expect(stages[0].places.map((p) => p.name)).toEqual(['Kalbarri']);
    // The label DERIVES — the name is never written onto the leg.
    expect(stages[0].name).toBe('');
    expect(stageLabel(stages[0])).toBe('Kalbarri');
  });

  it('writes the CITY’s own coordinates, and no country', () => {
    const doc = trip([nameless()]);
    const { stages } = locate(doc, '2025-11-03').proposal!.apply(doc);
    expect(stages[0].places[0].coords).toEqual({ lat: -27.7105, lon: 114.165 });
    expect(stages[0].places[0].region).toBe('');
    expect(JSON.stringify(stages[0])).not.toContain('AU');
  });

  it('joins the route of a leg that already names places', () => {
    const stage = createTripStage('', '', '2025-11-02', '2025-11-06', [
      createTripPlace('Perth', '', { lat: -31.9522, lon: 115.8614 }),
    ]);
    const doc = trip([stage]);
    const result = locate(doc, '2025-11-03');

    expect(result.proposal?.id).toBe('route');
    const { stages } = result.proposal!.apply(doc);
    expect(stages[0].places.map((p) => p.name)).toEqual(['Perth', 'Kalbarri']);
    expect(stageLabel(stages[0])).toBe('Perth → Kalbarri');
  });

  it('touches no other leg', () => {
    const before = createTripStage('', '', '2025-11-01', '2025-11-01', [
      createTripPlace('Perth', '', null),
    ]);
    const stage = createTripStage('', '', '2025-11-02', '2025-11-06');
    const doc = trip([before, stage]);
    const { stages } = locate(doc, '2025-11-03').proposal!.apply(doc);
    expect(stages[0]).toBe(before);
  });

  it('answers about the LAST leg covering the day, as every reader does', () => {
    const first = createTripStage('', '', '2025-11-01', '2025-11-03');
    const second = createTripStage('', '', '2025-11-03', '2025-11-08');
    const result = locate(trip([first, second]), '2025-11-03');
    expect(result.stage?.id).toBe(second.id);
  });
});

describe('locatePicture — a day no leg covers', () => {
  it('starts one there, carrying the place', () => {
    const doc = trip();
    const result = locate(doc, '2025-11-03');

    expect(result.proposal?.id).toBe('start');
    expect(result.stage).toBeNull();

    const { stages, selectedId } = result.proposal!.apply(doc);
    expect(stages).toHaveLength(1);
    expect(stages[0].id).toBe(selectedId);
    expect(stages[0].startDate).toBe('2025-11-03');
    expect(stages[0].places.map((p) => p.name)).toEqual(['Kalbarri']);
  });

  it('runs to the day before the next leg, and says so before it is accepted', () => {
    const next = createTripStage('', '', '2025-11-10', '2025-11-14');
    const doc = trip([next]);
    const result = locate(doc, '2025-11-03');

    expect(result.proposal?.detail).toContain('9 Nov 2025');
    const { stages, selectedId } = result.proposal!.apply(doc);
    const minted = stages.find((s) => s.id === selectedId)!;
    expect(minted.endDate).toBe('2025-11-09');
    // The leg it was offered beside is untouched.
    expect(stages.find((s) => s.id === next.id)).toBe(next);
  });

  it('applies against the trip it is handed, not a copy taken earlier', () => {
    const doc = trip();
    const proposal = locate(doc, '2025-11-03').proposal!;
    const meanwhile: TripDoc = {
      ...doc,
      stages: [createTripStage('', '', '2025-11-08', '2025-11-12')],
    };
    const { stages, selectedId } = proposal.apply(meanwhile);
    expect(stages).toHaveLength(2);
    expect(stages.find((s) => s.id === selectedId)!.endDate).toBe('2025-11-07');
  });
});

describe('locatePicture — what it measures', () => {
  it('reports how far the named city is from the picture', () => {
    const result = locate(trip(), '2025-11-03');
    expect(result.km).not.toBeNull();
    expect(result.km!).toBeLessThan(2);
  });

  it('names nothing at all with an empty index, and refuses to invent', () => {
    const result = locatePicture({
      trip: trip(),
      date: '2025-11-03',
      coords: AT_KALBARRI,
      cities: [],
    });
    expect(result.silence).toBe('no-name');
    expect(result.city).toBeNull();
  });

  it('holds the contest the deduction holds — the nearer place, not the bigger', () => {
    const atPerth = locate(trip(), '2025-11-03', { lat: -31.95, lon: 115.86 });
    expect(atPerth.city?.name).toBe('Perth');
  });
});
