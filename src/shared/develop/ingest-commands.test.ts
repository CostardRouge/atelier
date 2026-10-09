import { describe, expect, it } from 'vitest';
import { filterRows, readDay } from './ingest-commands';

const rows = [
  { id: 1, media_type: 'photo' as const, verdict: 'pick', star: 4 },
  { id: 2, media_type: 'photo' as const, verdict: 'reject', star: 0 },
  { id: 3, media_type: 'video' as const, verdict: 'pick', star: 2 },
  { id: 4, media_type: 'photo' as const },
];

describe('filterRows', () => {
  it('keeps everything with no filter', () => {
    expect(filterRows(rows, {}).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('narrows by verdict, stars and kind together', () => {
    expect(filterRows(rows, { verdict: 'pick' }).map((r) => r.id)).toEqual([1, 3]);
    expect(filterRows(rows, { verdict: 'pick', media: 'photo' }).map((r) => r.id)).toEqual([1]);
    expect(filterRows(rows, { minStars: 3 }).map((r) => r.id)).toEqual([1]);
  });

  it('reads a row with no culling as unrated', () => {
    expect(filterRows(rows, { verdict: 'unrated' }).map((r) => r.id)).toEqual([4]);
  });
});

describe('readDay', () => {
  it('takes a calendar day and refuses anything else', () => {
    expect(readDay('date', '2026-10-09')).toBe('2026-10-09');
    expect(() => readDay('date', '2026-02-30')).toThrow(/not a calendar day/);
    expect(() => readDay('date', '9/10/2026')).toThrow(/YYYY-MM-DD/);
  });
});
