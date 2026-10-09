import { describe, expect, it } from 'vitest';
import type { DayPoint, DayTrack } from './day-track';
import { EMPTY_DRAFT, haltName, haltPlace } from './deduce-draft';
import type { GazetteerCity } from './gazetteer';
import {
  addPolarstepsFiles,
  isExportFile,
  dayOfFix,
  localDay,
  mergeDays,
  polarstepsDays,
  readPolarstepsFile,
  solarDay,
  sourcesOf,
  splitDetail,
  stepFor,
  summarisePolarsteps,
  zoneAt,
  type PolarstepsExport,
  type PolarstepsStep,
  type PolarstepsTrip,
} from './polarsteps';
import type { TrackLeg } from './segment-track';
import { trackChapters } from './track-chapters';

// Every place, name and time below is INVENTED: a lake, a gorge and a
// station that exist nowhere, at round coordinates.

/** Unix seconds of a UTC wall time. */
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

const rawStep = (extra: Record<string, unknown> = {}, location: Record<string, unknown> = {}) => ({
  id: 1,
  display_name: 'Lake Example',
  name: '',
  start_time: utc(2025, 7, 2, 22),
  end_time: null,
  timezone_id: 'Australia/Brisbane',
  is_deleted: false,
  location: {
    name: 'Example Town',
    detail: 'Australia',
    full_detail: 'Queensland, Australia',
    country_code: 'AU',
    lat: -25.5,
    lon: 152.5,
    ...location,
  },
  ...extra,
});

const tripJson = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'Invented trip', timezone_id: 'Australia/Brisbane', all_steps: steps, ...extra });

const readTrip = (steps: unknown[], extra: Record<string, unknown> = {}): PolarstepsTrip => {
  const read = readPolarstepsFile('trip.json', tripJson(steps, extra));
  if ('error' in read || read.kind !== 'trip') throw new Error('not a trip');
  return read.trip;
};

const step = (extra: Partial<PolarstepsStep> = {}): PolarstepsStep => ({
  id: 's',
  name: 'Lake Example',
  place: '',
  state: 'Queensland',
  area: '',
  country: 'Australia',
  countryCode: 'AU',
  lat: -25.5,
  lon: 152.5,
  start: utc(2025, 7, 2, 22),
  zone: 'Australia/Brisbane',
  date: '2025-07-03',
  ...extra,
});

describe('reading the files', () => {
  it('reads a trip.json: steps in time order, deleted and broken ones left out', () => {
    const trip = readTrip([
      rawStep({ id: 2, display_name: 'Second', start_time: utc(2025, 7, 5) }),
      rawStep({ id: 1 }),
      rawStep({ id: 3, is_deleted: true }),
      rawStep({ id: 4, start_time: null }),
      rawStep({ id: 5 }, { lat: 0, lon: 0 }),
    ]);
    expect(trip.steps.map((s) => s.name)).toEqual(['Lake Example', 'Second']);
    expect(trip.skipped).toBe(3);
    expect(trip.zone).toBe('Australia/Brisbane');
    expect(trip.steps[0]).toMatchObject({
      name: 'Lake Example',
      place: 'Example Town',
      state: 'Queensland',
      country: 'Australia',
      countryCode: 'AU',
      // 22:00 UTC on the 2nd is 08:00 on the 3rd in Brisbane.
      date: '2025-07-03',
    });
  });

  it('names a step by its display name, else its name, else its location', () => {
    expect(readTrip([rawStep({ display_name: '', name: 'Own name' })]).steps[0].name).toBe('Own name');
    expect(readTrip([rawStep({ display_name: '', name: '' })]).steps[0].name).toBe('Example Town');
  });

  it('reads a locations.json and refuses a fix off the globe', () => {
    const read = readPolarstepsFile(
      'locations.json',
      JSON.stringify({
        locations: [
          { lat: -25, lon: 152, time: utc(2025, 7, 3, 1) },
          { lat: 0, lon: 0, time: utc(2025, 7, 3, 2) },
          { lat: 95, lon: 152, time: utc(2025, 7, 3, 3) },
          { lat: -25, lon: 152 },
        ],
      }),
    );
    expect(read).toMatchObject({ kind: 'locations', track: { skipped: 3 } });
    if ('error' in read || read.kind !== 'locations') return;
    expect(read.track.fixes).toHaveLength(1);
  });

  it('tells a file by its content, whatever its name', () => {
    expect(readPolarstepsFile('renamed.json', tripJson([rawStep()]))).toMatchObject({ kind: 'trip' });
  });

  it('refuses garbage with a reason', () => {
    expect(readPolarstepsFile('trip.json', '{not json')).toEqual({ error: 'trip.json is not JSON.' });
    expect(readPolarstepsFile('user.json', '{"id":1}')).toMatchObject({ error: expect.stringContaining('neither') });
    expect(readPolarstepsFile('export.zip', '')).toMatchObject({ error: expect.stringContaining('unzip it') });
    expect(readPolarstepsFile('trip.json', tripJson([rawStep({ start_time: 'soon' })]))).toMatchObject({
      error: expect.stringContaining('none with a time'),
    });
    expect(readPolarstepsFile('locations.json', '{"locations":[{"lat":1}]}')).toMatchObject({
      error: expect.stringContaining('no fix'),
    });
  });

  it('splits a full detail into a state it can recognise, else an area', () => {
    expect(splitDetail('Australia', 'AU')).toEqual({ state: '', area: '', country: 'Australia' });
    expect(splitDetail('Some Shire, Queensland, Australia', 'AU')).toEqual({
      state: 'Queensland',
      area: 'Some Shire',
      country: 'Australia',
    });
    // Not a state of Australia: a finer area, and the state stays unknown.
    expect(splitDetail('Invented Land, Australia', 'AU')).toEqual({ state: '', area: 'Invented Land', country: 'Australia' });
    // A country with no table: the part before it is taken as the state.
    expect(splitDetail('Bavaria, Germany', 'DE')).toEqual({ state: 'Bavaria', area: '', country: 'Germany' });
  });
});

describe('the local day', () => {
  it('puts 07:00 in Brisbane on the LOCAL day, not the UTC one before it', () => {
    const t = utc(2025, 7, 2, 21); // 07:00 on the 3rd in Brisbane (UTC+10)
    expect(localDay(t, 'Australia/Brisbane')).toBe('2025-07-03');
    expect(localDay(t, 'UTC')).toBe('2025-07-02');
  });

  it('follows the zone of the last step begun, the first one before any', () => {
    const trip = readTrip([
      rawStep({ id: 1, start_time: utc(2025, 7, 1), timezone_id: 'Australia/Brisbane' }),
      rawStep({ id: 2, start_time: utc(2025, 7, 9, 15), timezone_id: 'Australia/Darwin' }, { lat: -14, lon: 132 }),
    ]);
    expect(zoneAt(trip.steps, utc(2025, 6, 20))).toBe('Australia/Brisbane');
    expect(zoneAt(trip.steps, utc(2025, 7, 5))).toBe('Australia/Brisbane');
    expect(zoneAt(trip.steps, utc(2025, 7, 10))).toBe('Australia/Darwin');
    // 14:15 UTC is 23:45 in Darwin (UTC+9:30) but 00:15 the next day in Brisbane.
    const late = { lat: -14, lon: 132, time: utc(2025, 7, 10, 14, 15) };
    expect(dayOfFix(late, trip)).toBe('2025-07-10');
    expect(localDay(late.time, 'Australia/Brisbane')).toBe('2025-07-11');
  });

  it('honours daylight saving: half past midnight in Melbourne in December', () => {
    // 13:30 UTC on 9 Dec is 00:30 on the 10th under AEDT (UTC+11); at a
    // fixed UTC+10 it would still be the 9th.
    expect(localDay(utc(2025, 12, 9, 13, 30), 'Australia/Melbourne')).toBe('2025-12-10');
    expect(localDay(utc(2025, 7, 9, 13, 30), 'Australia/Melbourne')).toBe('2025-07-09');
  });

  it('falls back on the trip zone, then on the solar clock of the fix', () => {
    const noSteps: PolarstepsTrip = { name: '', zone: 'Australia/Perth', steps: [], skipped: 0 };
    const fix = { lat: -31, lon: 116, time: utc(2025, 7, 2, 17) }; // 01:00 on the 3rd in Perth
    expect(dayOfFix(fix, noSteps)).toBe('2025-07-03');
    expect(dayOfFix(fix, null)).toBe(solarDay(fix.time, fix.lon));
    expect(solarDay(fix.time, 116)).toBe('2025-07-03'); // 116° → UTC+8
  });

  it('refuses an unknown zone rather than guessing one', () => {
    expect(localDay(utc(2025, 7, 1), 'Not/AZone')).toBeNull();
    const trip = readTrip([rawStep({ timezone_id: 'Not/AZone' })], { timezone_id: 'Australia/Brisbane' });
    expect(trip.steps[0].zone).toBe('Australia/Brisbane');
  });
});

describe('one position per day', () => {
  const exp = (fixes: { lat: number; lon: number; time: number }[], steps: PolarstepsStep[] = []): PolarstepsExport => ({
    trip: { name: '', zone: 'Australia/Brisbane', steps, skipped: 0 },
    track: { fixes, skipped: 0 },
  });

  it('takes the MEDIAN of a local day, counts its fixes (not as pictures) and leaves out days outside the trip', () => {
    const days = polarstepsDays(
      exp([
        { lat: -25, lon: 152, time: utc(2025, 7, 2, 21) }, // 3 Jul, local morning
        { lat: -25.2, lon: 152.2, time: utc(2025, 7, 3, 2) },
        { lat: -20, lon: 150, time: utc(2025, 7, 3, 5) }, // an odd fix: the median ignores it
        { lat: -25, lon: 152, time: utc(2025, 6, 1) }, // before the trip
      ]),
      '2025-07-01',
      '2025-07-31',
    );
    expect(days.track).toEqual([
      { date: '2025-07-03', lat: -25, lon: 152, count: 0, measured: 3, inferred: false, from: 'track' },
    ]);
  });

  it('gives a step its own day', () => {
    const days = polarstepsDays(exp([], [step()]), '2025-07-01', '2025-07-31');
    expect(days.steps).toEqual([
      { date: '2025-07-03', lat: -25.5, lon: 152.5, count: 0, measured: 1, inferred: false, from: 'step' },
    ]);
  });
});

describe('mergeDays', () => {
  const day = (date: string, lat: number, extra: Partial<DayPoint> = {}): DayPoint => ({
    date,
    lat,
    lon: 150,
    count: 10,
    measured: 10,
    inferred: false,
    ...extra,
  });
  const instance: DayTrack = {
    points: [day('2025-07-01', -1), day('2025-07-02', -2), day('2025-07-03', -3, { inferred: true, measured: 0 })],
    blind: ['2025-07-04', '2025-07-05'],
  };

  it('the track wins, a measured instance day next, then a step, then a guessed day', () => {
    const merged = mergeDays(instance, {
      track: [day('2025-07-02', -20, { from: 'track' })],
      steps: [day('2025-07-01', -10, { from: 'step' }), day('2025-07-03', -30, { from: 'step' }), day('2025-07-04', -40, { from: 'step' })],
    });
    expect(merged.points.map((p) => [p.date, p.lat, p.from, p.count])).toEqual([
      ['2025-07-01', -1, 'instance', 10],
      // The track places the day; the pictures behind it stay the instance's.
      ['2025-07-02', -20, 'track', 10],
      ['2025-07-03', -30, 'step', 10],
      ['2025-07-04', -40, 'step', 10],
    ]);
    // A blind day the export placed is no longer blind.
    expect(merged.blind).toEqual(['2025-07-05']);
    expect(sourcesOf(merged)).toEqual({ instance: 1, track: 1, step: 2 });
  });

  it('reads the export alone when there is no instance', () => {
    const merged = mergeDays(null, { track: [day('2025-07-02', -20, { from: 'track' })], steps: [] });
    expect(merged).toEqual({ points: [day('2025-07-02', -20, { from: 'track' })], blind: [] });
  });
});

describe('names', () => {
  const leg = (extra: Partial<TrackLeg> = {}): TrackLeg => ({
    startDate: '2025-07-02',
    endDate: '2025-07-05',
    centroid: { lat: -25.5, lon: 152.6 },
    dayCount: 4,
    bridged: 0,
    count: 40,
    inferred: false,
    short: false,
    absorbed: 0,
    ...extra,
  });

  it('a halt takes the nearest step of its own days', () => {
    const near = step({ id: 'near', name: 'Near', date: '2025-07-04', lat: -25.5, lon: 152.6 });
    const further = step({ id: 'further', name: 'Further', date: '2025-07-03', lat: -25.6, lon: 152.9 });
    const otherDay = step({ id: 'other', name: 'Other day', date: '2025-07-09', lat: -25.5, lon: 152.6 });
    const far = step({ id: 'far', name: 'Far', date: '2025-07-02', lat: -20, lon: 150 });
    expect(stepFor(leg(), [further, otherDay, far, near])?.name).toBe('Near');
    expect(stepFor(leg(), [otherDay, far])).toBeNull();
  });

  /** A town of the shipped index across the water from the invented lake. */
  const TOWN: GazetteerCity = {
    name: 'Across The Water',
    country: 'AU',
    lat: -25.3,
    lon: 152.9,
    population: 5000,
    section: false,
    regionKey: 'AU.04',
    region: 'Queensland',
  };

  it('beats the index: the step names the halt, the index still says its region', () => {
    const lake = step({ name: 'Lake Example', state: '', date: '2025-07-03' });
    const [entry] = trackChapters([leg()], [TOWN], { steps: [lake] });
    const halt = entry.halts[0];
    expect(halt.city?.name).toBe('Across The Water');
    expect(haltName(halt, EMPTY_DRAFT)).toBe('Lake Example');
    expect(entry.chapter.places).toEqual([{ name: 'Lake Example', region: 'Queensland', lat: -25.5, lon: 152.5 }]);
    expect(haltPlace(halt, EMPTY_DRAFT)).toMatchObject({
      name: 'Lake Example',
      state: 'Queensland',
      coords: { lat: -25.5, lon: 152.5 },
      country: 'Australia',
      countryCode: 'AU',
      source: 'polarsteps',
      arrived: '2025-07-02',
      left: '2025-07-05',
    });
  });

  it('names a halt the index cannot reach', () => {
    const [entry] = trackChapters([leg()], [], { steps: [step({ name: 'Nowhere Station' })] });
    expect(haltName(entry.halts[0], EMPTY_DRAFT)).toBe('Nowhere Station');
  });

  it('leaves the index alone where no step is of the halt', () => {
    const [entry] = trackChapters([leg()], [TOWN], { steps: [step({ date: '2025-08-01' })] });
    expect(entry.halts[0].step).toBeUndefined();
    expect(haltName(entry.halts[0], EMPTY_DRAFT)).toBe('Across The Water');
  });
});

describe('addPolarstepsFiles', () => {
  const locations = (time: number) => JSON.stringify({ locations: [{ lat: -25, lon: 152, time }] });

  it('takes the two halves one drop at a time, and says what it refused', () => {
    const first = addPolarstepsFiles(null, [{ name: 'trip.json', body: tripJson([rawStep()]) }]);
    expect(first.value?.trip?.steps).toHaveLength(1);
    expect(first.value?.track).toBeNull();
    const second = addPolarstepsFiles(first.value, [
      { name: 'locations.json', body: locations(utc(2025, 7, 3)) },
      { name: 'user.json', body: '{}' },
    ]);
    expect(second.value?.trip?.steps).toHaveLength(1);
    expect(second.value?.track?.fixes).toHaveLength(1);
    expect(second.errors).toHaveLength(1);
  });

  it('of an export of several trips, keeps the files covering this trip', () => {
    const { value } = addPolarstepsFiles(
      null,
      [
        { name: 'trip.json', body: tripJson([rawStep({ start_time: utc(2023, 1, 5) })]) },
        { name: 'trip.json', body: tripJson([rawStep({ display_name: 'This one' })]) },
        { name: 'locations.json', body: locations(utc(2023, 1, 5)) },
        { name: 'locations.json', body: locations(utc(2025, 7, 3)) },
      ],
      { from: '2025-07-01', to: '2025-07-31' },
    );
    expect(value?.trip?.steps[0].name).toBe('This one');
    expect(value?.track?.fixes[0].time).toBe(utc(2025, 7, 3));
  });

  it('takes GPX files as the track, one journey across a file a day', () => {
    const gpx = (day: number) =>
      `<gpx><trk><trkseg><trkpt lat="-25" lon="152"><time>2025-07-0${day}T02:00:00Z</time></trkpt>` +
      `<trkpt lat="-25.1" lon="152.1"><time>2025-07-0${day}T03:00:00Z</time></trkpt></trkseg></trk></gpx>`;
    const { value, errors } = addPolarstepsFiles(
      null,
      [
        { name: 'day3.gpx', body: gpx(3) },
        { name: 'day4.GPX', body: gpx(4) },
        { name: 'plan.gpx', body: '<gpx><rtept lat="1" lon="2"></rtept></gpx>' },
      ],
      { from: '2025-07-01', to: '2025-07-31' },
    );
    expect(value?.track?.origin).toBe('gpx');
    expect(value?.track?.fixes).toHaveLength(4);
    expect(errors).toEqual(['plan.gpx has no times: a planned route cannot be put on the trip’s clock.']);
    // A locations.json covering more of the trip wins over them.
    const more = JSON.stringify({ locations: [3, 4, 5, 6].map((d) => ({ lat: -25, lon: 152, time: utc(2025, 7, d) })) });
    const both = addPolarstepsFiles(null, [{ name: 'day3.gpx', body: gpx(3) }, { name: 'locations.json', body: more }], { from: '2025-07-01', to: '2025-07-31' });
    expect(both.value?.track?.origin).toBeUndefined();
    expect(isExportFile('Track 2025-07-03.gpx')).toBe(true);
  });

  it('summarises what was read against the trip', () => {
    const { value } = addPolarstepsFiles(null, [
      { name: 'trip.json', body: tripJson([rawStep()]) },
      { name: 'locations.json', body: locations(utc(2025, 7, 4, 3)) },
    ]);
    expect(summarisePolarsteps(value!, '2025-07-01', '2025-07-31')).toEqual({
      steps: 1,
      fixes: 1,
      first: '2025-07-03',
      last: '2025-07-04',
      covered: 2,
      solar: false,
    });
  });
});
