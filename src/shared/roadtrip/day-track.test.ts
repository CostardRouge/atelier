import { describe, expect, it } from 'vitest';
import { readDayPoint, readDayTrack } from './day-track';

/** A row shaped exactly as `GET /api/assets/geo?by=day` sends one. */
const row = (extra: Record<string, unknown> = {}) => ({
  date: '2025-11-02',
  lat: -31.95,
  lon: 115.86,
  count: 120,
  measured: 40,
  source: 'measured',
  ...extra,
});

describe('readDayPoint', () => {
  it('reads a well-formed row as it stands', () => {
    expect(readDayPoint(row())).toMatchObject({
      date: '2025-11-02',
      lat: -31.95,
      lon: 115.86,
      count: 120,
      measured: 40,
      inferred: false,
    });
  });

  it('reads provenance from the word the instance really sends', () => {
    expect(readDayPoint(row({ source: 'inferred' }))).toMatchObject({ inferred: true });
    expect(readDayPoint(row({ source: 'measured' }))).toMatchObject({ inferred: false });
    // `source` wins over the counts, so a day placed by five real fixes among
    // eight hundred bulk-accepted ones is still measured.
    expect(readDayPoint(row({ source: 'measured', measured: 5, count: 805 }))).toMatchObject({
      inferred: false,
    });
  });

  it('refuses an instant rather than slicing a day out of it', () => {
    expect(readDayPoint(row({ date: '2025-11-02T07:00:00Z' }))).toBeNull();
  });

  it('refuses a calendar impossibility', () => {
    expect(readDayPoint(row({ date: '2025-02-30' }))).toBeNull();
  });

  it('refuses a row with no usable position', () => {
    expect(readDayPoint(row({ lat: null }))).toBeNull();
    expect(readDayPoint(row({ lon: 'east' }))).toBeNull();
    expect(readDayPoint(row({ lat: Number.NaN }))).toBeNull();
  });

  it('refuses a position off the globe', () => {
    expect(readDayPoint(row({ lat: -91 }))).toBeNull();
    expect(readDayPoint(row({ lon: 181 }))).toBeNull();
  });

  it('refuses Null Island, which is what a camera writes with no fix', () => {
    expect(readDayPoint(row({ lat: 0, lon: 0 }))).toBeNull();
    // A real position ON the equator or the meridian is not Null Island.
    expect(readDayPoint(row({ lat: 0, lon: 115.86 }))).not.toBeNull();
  });

  it('still understands a boolean, for an older or stubbed instance', () => {
    const bare = { date: '2025-11-02', lat: -31.95, lon: 115.86, count: 120, measured: 40 };
    expect(readDayPoint({ ...bare, inferred: true })).toMatchObject({ inferred: true });
  });

  it('falls back to the counts only when provenance is not stated at all', () => {
    const bare = { date: '2025-11-02', lat: -31.95, lon: 115.86, count: 120 };
    expect(readDayPoint({ ...bare, measured: 0 })).toMatchObject({ inferred: true });
    expect(readDayPoint({ ...bare, measured: 3 })).toMatchObject({ inferred: false });
  });

  it('trusts the smaller number when a row says more measured than it holds', () => {
    expect(readDayPoint(row({ count: 5, measured: 900 }))).toMatchObject({ measured: 5 });
  });

  it('refuses anything that is not a row', () => {
    expect(readDayPoint(null)).toBeNull();
    expect(readDayPoint('2025-11-02')).toBeNull();
  });
});

describe('readDayTrack', () => {
  it('puts the days in calendar order whatever order they arrived in', () => {
    const { points } = readDayTrack([
      row({ date: '2025-11-04' }),
      row({ date: '2025-11-02' }),
      row({ date: '2025-11-03' }),
    ]);
    expect(points.map((p) => p.date)).toEqual(['2025-11-02', '2025-11-03', '2025-11-04']);
  });

  it('keeps a DECLARED GAP apart, which is why one request is enough', () => {
    // A day matching the filters with no position at all is still sent, with
    // null coordinates. That is "no data for this day", not "no media".
    const { points, blind } = readDayTrack([
      row({ date: '2025-11-02' }),
      { date: '2025-11-03', lat: null, lon: null, count: 84, measured: 0, source: null },
      row({ date: '2025-11-04' }),
    ]);
    expect(points.map((p) => p.date)).toEqual(['2025-11-02', '2025-11-04']);
    expect(blind).toEqual(['2025-11-03']);
  });

  it('keeps the FIRST of a repeated day, so page order cannot decide', () => {
    const { points } = readDayTrack([
      row({ date: '2025-11-02', count: 1 }),
      row({ date: '2025-11-02', count: 999 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].count).toBe(1);
  });

  it('never lets one date be both placed and blind', () => {
    const { points, blind } = readDayTrack([
      row({ date: '2025-11-02' }),
      { date: '2025-11-02', lat: null, lon: null, count: 5, measured: 0, source: null },
    ]);
    expect(points.map((p) => p.date)).toEqual(['2025-11-02']);
    expect(blind).toEqual([]);
  });

  it('drops a row that is neither a position nor a gap', () => {
    const { points, blind } = readDayTrack([row({ date: 'hier' }), row({ date: '2025-11-03' })]);
    expect(points.map((p) => p.date)).toEqual(['2025-11-03']);
    expect(blind).toEqual([]);
  });

  it('has nothing to say about an empty answer', () => {
    expect(readDayTrack([])).toEqual({ points: [], blind: [] });
  });
});
