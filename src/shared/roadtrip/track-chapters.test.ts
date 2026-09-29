import { describe, expect, it } from 'vitest';
import { chaptersOf, doubtful, trackChapters } from './track-chapters';
import type { GazetteerCity } from './gazetteer';
import type { DayPoint } from './day-track';
import { segmentTrack, type TrackLeg } from './segment-track';
import { importTimeline } from './timeline-import';
import { stageLabel, stageRegionLabel } from './trip-places';

const city = (
  name: string,
  lat: number,
  lon: number,
  regionKey = 'AU.08',
  region = 'Western Australia',
): GazetteerCity => ({
  name,
  country: 'AU',
  lat,
  lon,
  population: 2000,
  section: false,
  regionKey,
  region,
});

const KALBARRI = city('Kalbarri', -27.7105, 114.165);
const GERALDTON = city('Geraldton', -28.7747, 114.6146);
const DARWIN = city('Darwin', -12.4611, 130.8418, 'AU.03', 'Northern Territory');

const leg = (extra: Partial<TrackLeg> = {}): TrackLeg => ({
  startDate: '2025-11-02',
  endDate: '2025-11-05',
  centroid: { lat: -27.71, lon: 114.165 },
  dayCount: 4,
  bridged: 0,
  count: 400,
  inferred: false,
  short: false,
  absorbed: 0,
  ...extra,
});

/** A halt sitting on a city, on the given days. */
const at = (
  place: GazetteerCity,
  startDate: string,
  endDate: string,
  extra: Partial<TrackLeg> = {},
) => leg({ startDate, endDate, centroid: { lat: place.lat, lon: place.lon }, ...extra });

describe('trackChapters', () => {
  it('offers the name in the PLACE and leaves the title null', () => {
    const [entry] = trackChapters([leg()], [KALBARRI]);
    expect(entry.chapter.title).toBeNull();
    expect(entry.chapter.places).toEqual([
      { name: 'Kalbarri', region: 'Western Australia', lat: -27.7105, lon: 114.165 },
    ]);
    expect(entry.halts[0].city?.country).toBe('AU');
  });

  it('gives a leg nobody can name no place at all', () => {
    const middleOfNowhere = leg({ centroid: { lat: -31.5, lon: 128.9 } });
    const [entry] = trackChapters([middleOfNowhere], [KALBARRI]);
    expect(entry.chapter.places).toEqual([]);
    expect(entry.halts[0].city).toBeNull();
    expect(entry.region).toBe('');
  });

  it('keeps the country and the region KEY out of the document', () => {
    const [entry] = trackChapters([leg()], [KALBARRI], { nameByRegion: true });
    expect(JSON.stringify(entry.chapter)).not.toContain('AU');
  });

  it('keys a chapter on the day the leg begins, under its own prefix', () => {
    const [entry] = trackChapters([leg()], [KALBARRI]);
    expect(entry.chapter.id).toBe('track:2025-11-02');
  });

  it('changes the revision when the leg moves, not when it merely repeats', () => {
    const same = trackChapters([leg()], [KALBARRI])[0].chapter.revision;
    const again = trackChapters([leg()], [KALBARRI])[0].chapter.revision;
    const moved = trackChapters([leg({ endDate: '2025-11-07' })], [KALBARRI])[0].chapter.revision;
    expect(again).toBe(same);
    expect(moved).not.toBe(same);
  });

  it('names nothing when there is no index to name from', () => {
    const [entry] = trackChapters([leg()], []);
    expect(entry.chapter.places).toEqual([]);
  });

  it('takes the reach from the caller', () => {
    const outskirts = leg({ centroid: { lat: -28.3, lon: 114.165 } });
    expect(trackChapters([outskirts], [KALBARRI], { maxKm: 30 })[0].halts[0].city).toBeNull();
    expect(trackChapters([outskirts], [KALBARRI], { maxKm: 120 })[0].halts[0].city?.name).toBe(
      'Kalbarri',
    );
  });
});

describe('trackChapters, one chapter per region', () => {
  const index = [KALBARRI, GERALDTON, DARWIN];
  const trip = [
    at(GERALDTON, '2025-11-02', '2025-11-04'),
    at(KALBARRI, '2025-11-05', '2025-11-08'),
    at(DARWIN, '2025-11-12', '2025-11-15'),
  ];

  it('gathers the halts of one region into one chapter, its halts as places in order', () => {
    const entries = trackChapters(trip, index);
    expect(entries).toHaveLength(2);

    const [wa, nt] = entries;
    expect(wa.halts).toHaveLength(2);
    expect(wa.chapter.places?.map((p) => p.name)).toEqual(['Geraldton', 'Kalbarri']);
    expect(wa.chapter).toMatchObject({
      id: 'track:2025-11-02',
      startDate: '2025-11-02',
      endDate: '2025-11-08',
    });
    expect(wa.region).toBe('Western Australia');
    expect(nt.chapter.places?.map((p) => p.name)).toEqual(['Darwin']);
    expect(nt.region).toBe('Northern Territory');
  });

  it('leaves the title null by default, the label deriving from the places', () => {
    for (const entry of trackChapters(trip, index)) expect(entry.chapter.title).toBeNull();
  });

  it('writes the region as the title only when asked', () => {
    const titles = trackChapters(trip, index, { nameByRegion: true }).map((e) => e.chapter.title);
    expect(titles).toEqual(['Western Australia', 'Northern Territory']);
  });

  it('writes no title for a region GeoNames cannot name, even when asked', () => {
    const nameless = city('Somewhere', -27.7105, 114.165, 'AU.99', '');
    const [entry] = trackChapters([leg()], [nameless], { nameByRegion: true });
    expect(entry.chapter.title).toBeNull();
    expect(entry.chapter.places?.[0]).not.toHaveProperty('region');
  });

  it('lists a place once, at its first visit, when the chapter returns to it', () => {
    const loop = [
      at(GERALDTON, '2025-11-02', '2025-11-04'),
      at(KALBARRI, '2025-11-05', '2025-11-08'),
      at(GERALDTON, '2025-11-09', '2025-11-10'),
    ];
    const [entry] = trackChapters(loop, index);
    expect(entry.halts).toHaveLength(3);
    expect(entry.chapter.places?.map((p) => p.name)).toEqual(['Geraldton', 'Kalbarri']);
    expect(entry.chapter.endDate).toBe('2025-11-10');
  });

  it('lets a halt nobody can name ride along without a place and without a cut', () => {
    const [entry, ...rest] = trackChapters(
      [
        at(GERALDTON, '2025-11-02', '2025-11-04'),
        leg({
          startDate: '2025-11-05',
          endDate: '2025-11-05',
          centroid: { lat: -31.5, lon: 128.9 },
        }),
        at(KALBARRI, '2025-11-06', '2025-11-08'),
      ],
      index,
    );
    expect(rest).toEqual([]);
    expect(entry.halts).toHaveLength(3);
    expect(entry.chapter.places?.map((p) => p.name)).toEqual(['Geraldton', 'Kalbarri']);
  });

  it('changes the revision when a halt joins, even over the same span and volume', () => {
    const one = trackChapters([at(KALBARRI, '2025-11-02', '2025-11-08', { count: 800 })], index);
    const two = trackChapters(
      [at(GERALDTON, '2025-11-02', '2025-11-04'), at(KALBARRI, '2025-11-05', '2025-11-08')],
      index,
    );
    expect(one[0].chapter.id).toBe(two[0].chapter.id);
    expect(one[0].chapter.revision).not.toBe(two[0].chapter.revision);
  });

  it('hands the hop limit to the grouping', () => {
    // Geraldton to Kalbarri is ~130 km: one chapter by region, two past 100 km.
    const tight = trackChapters(trip.slice(0, 2), index, { maxHopKm: 100 });
    expect(tight.map((e) => e.chapter.places?.map((p) => p.name))).toEqual([
      ['Geraldton'],
      ['Kalbarri'],
    ]);
  });
});

describe('doubtful', () => {
  it('holds back a chapter made only of stops on the way and guesses', () => {
    const entries = trackChapters(
      [
        at(KALBARRI, '2025-11-02', '2025-11-05'),
        at(DARWIN, '2025-11-06', '2025-11-06', { short: true }),
        at(DARWIN, '2025-11-07', '2025-11-09', { inferred: true }),
      ],
      [KALBARRI, DARWIN],
    );
    expect(entries.map((e) => e.chapter.id)).toEqual(['track:2025-11-02', 'track:2025-11-06']);
    expect(doubtful(entries)).toEqual(new Set(['track:2025-11-06']));
  });

  it('does not untick a region for one doubtful halt inside it', () => {
    const entries = trackChapters(
      [
        at(GERALDTON, '2025-11-02', '2025-11-04'),
        at(KALBARRI, '2025-11-05', '2025-11-05', { short: true }),
      ],
      [KALBARRI, GERALDTON],
    );
    expect(entries).toHaveLength(1);
    expect(doubtful(entries)).toEqual(new Set());
  });
});

describe('the whole chain, day points to stages', () => {
  const day = (date: string, lat: number): DayPoint => ({
    date,
    lat,
    lon: 114.165,
    count: 100,
    measured: 50,
    inferred: false,
  });

  it('derives the leg label from the offered place, never pinning a name', () => {
    const { legs } = segmentTrack([
      day('2025-11-02', -27.71),
      day('2025-11-03', -27.7105),
      day('2025-11-04', -27.712),
    ]);
    const entries = trackChapters(legs, [KALBARRI]);
    const imported = importTimeline(chaptersOf(entries), {
      sourceId: 'winnow.example',
      importedAt: 1_700_000_000_000,
    });

    expect(imported.warnings).toEqual([]);
    expect(imported.stages).toHaveLength(1);

    const [stage] = imported.stages;
    // The name stays EMPTY and the label comes from the place — so renaming
    // the place renames the leg, which is the whole point of not pinning it.
    expect(stage.name).toBe('');
    expect(stageLabel(stage)).toBe('Kalbarri');
    expect(stage.places[0]).toMatchObject({
      name: 'Kalbarri',
      coords: { lat: -27.7105, lon: 114.165 },
    });
    expect(stage.origin).toMatchObject({
      sourceId: 'winnow.example',
      chapterId: 'track:2025-11-02',
    });
    expect(imported.span).toEqual({ startDate: '2025-11-02', endDate: '2025-11-04' });
  });

  it('gives a chapter the region its places agree on, and a two-place label', () => {
    const entries = trackChapters(
      [at(GERALDTON, '2025-11-02', '2025-11-04'), at(KALBARRI, '2025-11-05', '2025-11-08')],
      [KALBARRI, GERALDTON],
    );
    const imported = importTimeline(chaptersOf(entries), {
      sourceId: 'winnow.example',
      importedAt: 1_700_000_000_000,
    });
    const [stage] = imported.stages;
    expect(stage.name).toBe('');
    expect(stageLabel(stage)).toBe('Geraldton → Kalbarri');
    expect(stageRegionLabel(stage)).toBe('Western Australia');
  });

  it('carries an unnamed leg through with its dates and nothing else', () => {
    const { legs } = segmentTrack([day('2025-11-02', -31.5), day('2025-11-03', -31.5)]);
    const imported = importTimeline(chaptersOf(trackChapters(legs, [])), {
      sourceId: 'winnow.example',
      importedAt: 1_700_000_000_000,
    });

    expect(imported.warnings).toEqual([]);
    expect(imported.stages).toHaveLength(1);
    expect(imported.stages[0].places).toEqual([]);
    expect(stageLabel(imported.stages[0])).toBe('');
  });
});
