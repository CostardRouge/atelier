import { describe, expect, it } from 'vitest';
import type { HookDay } from './hook-variant';
import {
  defaultSpan,
  groupByDay,
  inSpan,
  initialExclusions,
  laterLeftOff,
  mergePool,
  quickSpans,
  reachSpan,
  sameRef,
  tripSpan,
  type PoolCandidate,
} from './picture-pool';

function calendar(total: number): HookDay[] {
  return Array.from({ length: total }, (_, i) => ({
    date: new Date(Date.UTC(2025, 2, 1 + i)).toISOString().slice(0, 10),
    dayNumber: i + 1,
    told: false,
    legStart: i === 0,
    pieces: [],
  }));
}

const ref = (name: string, extra: Partial<PoolCandidate['ref']> = {}) => ({
  name,
  size: 100,
  lastModified: 0,
  ...extra,
});

const cand = (
  key: string,
  date: string,
  origin: PoolCandidate['origin'],
  extra: Partial<PoolCandidate['ref']> = {},
  takenAt = 0,
): PoolCandidate => ({ key, ref: ref(`${key}.jpg`, extra), date, takenAt, origin });

describe('sameRef', () => {
  it('trusts a source id, then a hash, then name and size', () => {
    expect(sameRef(ref('a', { assetId: 'w/1' }), ref('b', { assetId: 'w/1' }))).toBe(true);
    expect(sameRef(ref('a', { assetId: 'w/1' }), ref('a', { assetId: 'w/2' }))).toBe(false);
    expect(sameRef(ref('a', { hash: 'h' }), ref('b', { hash: 'h' }))).toBe(true);
    expect(sameRef(ref('IMG.JPG'), ref('img.jpg'))).toBe(true);
    expect(sameRef(ref('img.jpg'), ref('img.jpg', { size: 101 }))).toBe(false);
  });
});

describe('mergePool', () => {
  it('offers a picture held in both places once, from the Library', () => {
    const library = [cand('a', '2025-03-02', 'library', { assetId: 'w/7' })];
    const instance = [
      cand('b', '2025-03-02', 'instance', { assetId: 'w/7' }),
      { ...cand('c', '2025-03-01', 'instance', { assetId: 'w/8' }), ref: ref('a.jpg', { assetId: 'w/8' }) },
      cand('d', '2025-03-01', 'instance', { assetId: 'w/9' }),
    ];
    const pool = mergePool(library, instance);
    expect(pool.map((c) => c.key)).toEqual(['d', 'a']);
  });

  it('orders by day, then by instant', () => {
    const pool = mergePool(
      [cand('late', '2025-03-02', 'library', {}, 20), cand('early', '2025-03-02', 'library', {}, 10)],
      [cand('first', '2025-03-01', 'instance', { assetId: 'w/1' }, 99)],
    );
    expect(pool.map((c) => c.key)).toEqual(['first', 'early', 'late']);
  });
});

describe('spans', () => {
  const cal = calendar(20);

  it('reaches from the first day to the piece’s own', () => {
    expect(reachSpan(cal, cal[9].date)).toEqual({ from: cal[0].date, to: cal[9].date });
    expect(reachSpan(cal, '2031-01-01')).toBeNull();
  });

  it('spans the whole trip, first day to last', () => {
    expect(tripSpan(cal)).toEqual({ from: cal[0].date, to: cal[19].date });
    expect(tripSpan([])).toBeNull();
  });

  it('opens on the days before this one, or on the days a held list covers', () => {
    expect(defaultSpan(cal, cal[9].date, [])).toEqual({ from: cal[0].date, to: cal[8].date });
    expect(defaultSpan(cal, cal[0].date, [])).toEqual({ from: cal[0].date, to: cal[0].date });
    const held = [
      { ref: ref('x'), date: cal[6].date },
      { ref: ref('y'), date: cal[2].date },
      { ref: ref('z'), date: '2031-01-01' },
    ];
    expect(defaultSpan(cal, cal[9].date, held)).toEqual({ from: cal[2].date, to: cal[6].date });
  });

  it('reopens on a held picture shot after the piece, so confirming does not drop it', () => {
    const held = [
      { ref: ref('x'), date: cal[3].date },
      { ref: ref('z'), date: cal[15].date },
    ];
    expect(defaultSpan(cal, cal[9].date, held)).toEqual({ from: cal[3].date, to: cal[15].date });
  });

  it('marks a later picture only for a variant that leaves it off', () => {
    expect(laterLeftOff(cal[12].date, cal[9].date, false)).toBe(true);
    expect(laterLeftOff(cal[12].date, cal[9].date, true)).toBe(false);
    expect(laterLeftOff(cal[9].date, cal[9].date, false)).toBe(false);
  });

  it('offers the leg only when it says something the trip does not', () => {
    const stages = [
      { startDate: cal[0].date, endDate: cal[4].date, label: '', places: [] },
      { startDate: cal[5].date, endDate: cal[19].date, label: '', places: [] },
    ];
    expect(quickSpans(cal, cal[15].date, stages).map((s) => s.id)).toEqual(['whole', 'trip', 'leg', 'week', 'day']);
    expect(quickSpans(cal, cal[3].date, stages).map((s) => s.id)).toEqual(['whole', 'trip', 'day']);
    const leg = quickSpans(cal, cal[15].date, stages).find((s) => s.id === 'leg');
    expect(leg).toMatchObject({ from: cal[5].date, to: cal[14].date });
    // A week that starts where the leg does says nothing new.
    expect(quickSpans(cal, cal[12].date, stages).map((s) => s.id)).toEqual(['whole', 'trip', 'leg', 'day']);
    // On the trip's first day, "the trip so far" IS that day.
    expect(quickSpans(cal, cal[0].date, stages).map((s) => s.id)).toEqual(['whole', 'trip']);
  });

  it('reaches past this piece with the whole trip, and drops it on a one-day trip', () => {
    const whole = quickSpans(cal, cal[9].date).find((s) => s.id === 'whole');
    expect(whole).toMatchObject({ from: cal[0].date, to: cal[19].date });
    const one = calendar(1);
    expect(quickSpans(one, one[0].date).map((s) => s.id)).toEqual(['whole']);
  });

  it('keeps only what was shot inside the span, both ends included', () => {
    const items = [
      cand('a', cal[1].date, 'library'),
      cand('b', cal[2].date, 'library'),
      cand('c', cal[3].date, 'library'),
    ];
    expect(inSpan(items, { from: cal[2].date, to: cal[3].date }).map((c) => c.key)).toEqual(['b', 'c']);
  });
});

describe('groupByDay', () => {
  it('groups in calendar order and names the trip day', () => {
    const cal = calendar(5);
    const groups = groupByDay(
      [cand('b', cal[3].date, 'library'), cand('a', cal[1].date, 'library'), cand('c', cal[3].date, 'library')],
      cal,
    );
    expect(groups.map((g) => [g.day?.dayNumber, g.items.map((c) => c.key)])).toEqual([
      [2, ['a']],
      [4, ['b', 'c']],
    ]);
  });
});

describe('initialExclusions', () => {
  const pool = [
    cand('a', '2025-03-01', 'library'),
    cand('b', '2025-03-01', 'instance', { assetId: 'w/2' }),
  ];

  it('takes everything when nothing is held yet', () => {
    expect(initialExclusions(pool, []).size).toBe(0);
  });

  it('ticks what the held list names, and nothing else', () => {
    const excluded = initialExclusions(pool, [{ ref: ref('other', { assetId: 'w/2' }), date: '2025-03-01' }]);
    expect([...excluded]).toEqual(['a']);
  });
});
