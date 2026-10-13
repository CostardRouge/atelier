import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from '../client';
import { dayHeading, dayRuns, normalSpan, openingSpan, rowDay, spanDays, spanLabel, spanPresets } from './span';

describe('a span', () => {
  it('orders its two ends and refuses what is not a date', () => {
    expect(normalSpan('2026-10-03', '2026-09-12')).toEqual({ from: '2026-09-12', to: '2026-10-03' });
    expect(normalSpan('2026-09-12', 'soon')).toBeNull();
  });

  it('counts both ends', () => {
    expect(spanDays({ from: '2026-09-12', to: '2026-10-03' })).toBe(22);
    expect(spanDays({ from: '2026-09-12', to: '2026-09-12' })).toBe(1);
  });

  it('is written as short as the reader allows', () => {
    expect(spanLabel({ from: '2026-09-12', to: '2026-10-03' })).toBe('12 Sep → 3 Oct 2026');
    expect(spanLabel({ from: '2026-09-12', to: '2026-09-30' })).toBe('12 → 30 Sep 2026');
    expect(spanLabel({ from: '2025-12-30', to: '2026-01-02' })).toBe('30 Dec 2025 → 2 Jan 2026');
    expect(spanLabel({ from: '2026-10-03', to: '2026-10-03' })).toBe('3 Oct 2026');
    expect(dayHeading('2026-09-12')).toBe('Sat 12 Sep 2026');
  });
});

describe('the presets', () => {
  it('ends every fixed one today, and lists the host first, once', () => {
    const p = spanPresets('2026-10-13', [{ label: 'Queensland leg', span: { from: '2026-09-21', to: '2026-09-12' } }]);
    expect(p[0]).toEqual({ id: 'host-0', label: 'Queensland leg', span: { from: '2026-09-12', to: '2026-09-21' } });
    expect(p.find((x) => x.id === 'week')?.span).toEqual({ from: '2026-10-07', to: '2026-10-13' });
    expect(p.find((x) => x.id === 'thirty')?.span).toEqual({ from: '2026-09-14', to: '2026-10-13' });
    expect(p.find((x) => x.id === 'month')?.span).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(p.find((x) => x.id === 'year')).toMatchObject({ label: '2026', span: { from: '2026-01-01', to: '2026-10-13' } });
    const same = spanPresets('2026-10-13', [{ label: 'This trip', span: { from: '2026-10-07', to: '2026-10-13' } }]);
    expect(same.map((x) => x.label)).toEqual(['This trip', 'Last 30 days', 'This month', '2026']);
  });

  it('opens on the host span, else the remembered one, else the month of the day, up to today', () => {
    const host = { from: '2026-09-12', to: '2026-10-03' };
    const kept = { from: '2026-01-01', to: '2026-01-31' };
    const today = '2026-10-13';
    expect(openingSpan('2026-10-13', today, host, kept)).toEqual(host);
    expect(openingSpan('2026-10-13', today, null, kept)).toEqual(kept);
    expect(openingSpan('2026-10-02', today)).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(openingSpan('2026-02-10', today)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(openingSpan('2025-12-31', today)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('days in the grid', () => {
  const row = (capture_date: string | null, captured_at: string | null) => ({ capture_date, captured_at }) as WinnowAssetRow;

  it('files a row under its camera-local day, else its instant', () => {
    expect(rowDay(row('2026-09-12', '2026-09-11T22:10:00Z'))).toBe('2026-09-12');
    expect(rowDay(row(null, '2026-09-11T22:10:00Z'))).toBe('2026-09-11');
    expect(rowDay(row(null, null))).toBeNull();
  });

  it('runs consecutive days without ever reordering', () => {
    const runs = dayRuns(['a1', 'a2', 'b1', 'a3', 'x'], (s) => (s === 'x' ? null : s[0]));
    expect(runs).toEqual([
      { day: 'a', items: ['a1', 'a2'] },
      { day: 'b', items: ['b1'] },
      { day: 'a', items: ['a3'] },
      { day: null, items: ['x'] },
    ]);
  });
});
