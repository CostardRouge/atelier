import { describe, expect, it } from 'vitest';
import { suggestPicks } from './suggest-picks';

let next = 1;
function row(hhmm: string, extra: Record<string, unknown> = {}) {
  return {
    id: next++,
    media_type: 'photo' as const,
    captured_at: `2026-01-03T${hhmm}:00Z`,
    captured_at_source: 'exif-wall' as const,
    gps_lat: null,
    gps_lon: null,
    camera_model: null,
    verdict: 'unrated',
    star: 0,
    ...extra,
  };
}

describe('suggestPicks', () => {
  it('never proposes a reject or a picture already in the piece', () => {
    const a = row('08:00', { verdict: 'reject' });
    const b = row('09:00');
    const c = row('10:00');
    const got = suggestPicks([a, b, c], 3, (r) => r.id === c.id);
    expect(got.map((p) => p.id)).toEqual([b.id]);
  });

  it('lets one frame stand for a burst, the best, said as such', () => {
    const b1 = row('10:00', { burst_id: 7, burst_count: 3, burst_cover_id: 0 });
    const b2 = row('10:00', { burst_id: 7, burst_count: 3, star: 4 });
    const b3 = row('10:00', { burst_id: 7, burst_count: 3 });
    const got = suggestPicks([b1, b2, b3, row('15:00')], 5);
    expect(got.map((p) => p.id)).toContain(b2.id);
    expect(got.find((p) => p.id === b2.id)?.reason).toBe('★4 · best of 3');
    expect(got.some((p) => p.id === b1.id || p.id === b3.id)).toBe(false);
  });

  it('spreads the picks over the day instead of crowding the busy morning', () => {
    const morning = Array.from({ length: 10 }, (_, i) => row(`08:${String(i * 5).padStart(2, '0')}`, { star: 3 }));
    const evening = row('19:30');
    const got = suggestPicks([...morning, evening], 2);
    expect(got.map((p) => p.id)).toContain(evening.id);
    expect(got[got.length - 1].id).toBe(evening.id);
  });

  it('answers in the order the frames were taken, a pick before stars in its window', () => {
    const late = row('18:00', { verdict: 'pick' });
    const early = row('07:00', { star: 2 });
    const earlyPick = row('07:10', { verdict: 'pick', star: 1 });
    const got = suggestPicks([late, early, earlyPick], 2);
    expect(got.map((p) => p.id)).toEqual([earlyPick.id, late.id]);
    expect(got[0].reason).toBe('Pick · ★1');
  });

  it('never lets a skipped frame stand for its window while a better one is left', () => {
    const a = row('08:00', { star: 1 });
    const b = row('12:00');
    const skipped = row('21:00', { verdict: 'skip' });
    const got = suggestPicks([a, b, skipped], 2);
    expect(got.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('says when a frame was chosen only to cover the day', () => {
    expect(suggestPicks([row('14:20')], 1)[0].reason).toBe('covers 14:20');
  });
});
