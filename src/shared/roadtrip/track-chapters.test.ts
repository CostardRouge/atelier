import { describe, expect, it } from 'vitest';
import { chaptersOf, doubtful, trackChapters } from './track-chapters';
import type { GazetteerCity } from './gazetteer';
import type { DayPoint } from './day-track';
import { segmentTrack, type TrackLeg } from './segment-track';
import { importTimeline } from './timeline-import';
import { stageLabel } from './trip-places';

const KALBARRI: GazetteerCity = {
  name: 'Kalbarri',
  country: 'AU',
  lat: -27.7105,
  lon: 114.165,
  population: 2602,
  section: false,
};

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

describe('trackChapters', () => {
  it('offers the name in the PLACE and leaves the title null', () => {
    const [entry] = trackChapters([leg()], [KALBARRI]);
    expect(entry.chapter.title).toBeNull();
    expect(entry.chapter.places).toEqual([
      { name: 'Kalbarri', lat: -27.7105, lon: 114.165 },
    ]);
    expect(entry.city?.country).toBe('AU');
  });

  it('gives a leg nobody can name no place at all', () => {
    const middleOfNowhere = leg({ centroid: { lat: -31.5, lon: 128.9 } });
    const [entry] = trackChapters([middleOfNowhere], [KALBARRI]);
    expect(entry.chapter.places).toEqual([]);
    expect(entry.city).toBeNull();
  });

  it('keeps the country out of the document', () => {
    const [entry] = trackChapters([leg()], [KALBARRI]);
    expect(JSON.stringify(entry.chapter)).not.toContain('AU');
  });

  it('keys a chapter on the day the leg begins, under its own prefix', () => {
    const [entry] = trackChapters([leg()], [KALBARRI]);
    expect(entry.chapter.id).toBe('track:2025-11-02');
  });

  it('changes the revision when the leg moves, not when it merely repeats', () => {
    const same = trackChapters([leg()], [KALBARRI])[0].chapter.revision;
    const again = trackChapters([leg()], [KALBARRI])[0].chapter.revision;
    const moved = trackChapters([leg({ endDate: '2025-11-07' })], [KALBARRI])[0].chapter
      .revision;
    expect(again).toBe(same);
    expect(moved).not.toBe(same);
  });

  it('names nothing when there is no index to name from', () => {
    const [entry] = trackChapters([leg()], []);
    expect(entry.chapter.places).toEqual([]);
  });

  it('takes the reach from the caller', () => {
    const outskirts = leg({ centroid: { lat: -28.3, lon: 114.165 } });
    expect(trackChapters([outskirts], [KALBARRI], { maxKm: 30 })[0].city).toBeNull();
    expect(trackChapters([outskirts], [KALBARRI], { maxKm: 120 })[0].city?.name).toBe(
      'Kalbarri',
    );
  });
});

describe('doubtful', () => {
  it('holds back a stop on the way and a leg resting only on guesses', () => {
    const entries = trackChapters(
      [
        leg({ startDate: '2025-11-02', endDate: '2025-11-05' }),
        leg({ startDate: '2025-11-06', endDate: '2025-11-06', short: true }),
        leg({ startDate: '2025-11-07', endDate: '2025-11-09', inferred: true }),
      ],
      [KALBARRI],
    );
    expect(doubtful(entries)).toEqual(new Set(['track:2025-11-06', 'track:2025-11-07']));
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
