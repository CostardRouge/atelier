import { describe, expect, it } from 'vitest';
import { dayPointsFrom, readDayPoint } from './day-track';

const row = (extra: Record<string, unknown> = {}) => ({
  date: '2025-11-02',
  lat: -31.95,
  lon: 115.86,
  count: 120,
  measured: 40,
  inferred: false,
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

  it('takes the instance at its word about provenance', () => {
    expect(readDayPoint(row({ inferred: true, measured: 40 }))).toMatchObject({
      inferred: true,
    });
  });

  it('falls back to the counts only when provenance is not stated', () => {
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

describe('dayPointsFrom', () => {
  it('puts the days in calendar order whatever order they arrived in', () => {
    const points = dayPointsFrom([
      row({ date: '2025-11-04' }),
      row({ date: '2025-11-02' }),
      row({ date: '2025-11-03' }),
    ]);
    expect(points.map((p) => p.date)).toEqual(['2025-11-02', '2025-11-03', '2025-11-04']);
  });

  it('keeps the FIRST of a repeated day, so page order cannot decide', () => {
    const points = dayPointsFrom([
      row({ date: '2025-11-02', count: 1 }),
      row({ date: '2025-11-02', count: 999 }),
    ]);
    expect(points).toHaveLength(1);
    expect(points[0].count).toBe(1);
  });

  it('drops what it cannot read without dropping the rest', () => {
    const points = dayPointsFrom([row({ date: 'hier' }), row({ date: '2025-11-03' })]);
    expect(points.map((p) => p.date)).toEqual(['2025-11-03']);
  });
});
