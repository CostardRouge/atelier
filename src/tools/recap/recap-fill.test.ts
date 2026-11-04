import { describe, expect, it } from 'vitest';
import { fillWindows } from './recap-fill';
import { dayFromName } from '../../shared/recap/recap-days';

describe('recap fill', () => {
  it('asks a run of days in one window and days apart in their own', () => {
    expect(fillWindows(['2026-10-03', '2026-10-01', '2026-10-02', '2026-10-02'])).toEqual([['2026-10-01', '2026-10-03']]);
    expect(fillWindows(['2026-11-04', '2025-11-04', '2026-10-28', '2026-10-04'])).toEqual([
      ['2025-11-04', '2025-11-04'],
      ['2026-10-04', '2026-10-04'],
      ['2026-10-28', '2026-10-28'],
      ['2026-11-04', '2026-11-04'],
    ]);
    expect(fillWindows([])).toEqual([]);
  });

  it('reads a day out of a camera’s file name', () => {
    expect(dayFromName('DJI_20251104184207_0001_D.MP4')).toEqual({ day: '2025-11-04', minute: 18 * 60 + 42 });
    expect(dayFromName('IMG_20251104_184207.jpg')).toEqual({ day: '2025-11-04', minute: 18 * 60 + 42 });
    expect(dayFromName('PXL_20250230_1.jpg')).toBeNull();
    expect(dayFromName('holiday.jpg')).toBeNull();
  });
});

describe('fill from a Winnow', () => {
  it('asks the rule’s days, leaves the rejects out and reads what the rule ranks on', async () => {
    const { fillFromWinnow } = await import('./recap-fill');
    const { createRecapDoc } = await import('../../shared/recap/recap-doc');
    const asked: [string | undefined, string | undefined][] = [];
    const row = (id: number, day: string, extra: Record<string, unknown> = {}) => ({
      id,
      filename: `IMG_${id}.JPG`,
      media_type: 'photo',
      captured_at: `${day}T10:30:00Z`,
      captured_at_source: 'exif-wall',
      capture_date: day,
      camera_model: 'ILCE-7M4',
      star: 0,
      verdict: 'unrated',
      ...extra,
    });
    const client = {
      allAssets: async (q: { dateFrom?: string; dateTo?: string }) => {
        asked.push([q.dateFrom, q.dateTo]);
        return [row(1, q.dateFrom!), row(2, q.dateFrom!, { verdict: 'reject' }), row(3, q.dateFrom!, { star: 4, verdict: 'pick', media_type: 'video', duration_s: 6 })];
      },
    };
    const doc = createRecapDoc('onThisDay', 'local', { anchor: '2026-11-04', now: 1 });
    const pics = await fillFromWinnow(doc, client as never, 'winnow.example');
    expect(asked).toEqual([
      ['2025-11-04', '2025-11-04'],
      ['2026-10-04', '2026-10-04'],
      ['2026-10-28', '2026-10-28'],
      ['2026-11-04', '2026-11-04'],
    ]);
    expect(pics).toHaveLength(8);
    expect(pics[0]).toMatchObject({ key: 'w:winnow.example:1', origin: 'winnow', asset: 1, kind: 'photo', day: '2025-11-04', minute: 630, device: 'ILCE-7M4' });
    expect(pics[1]).toMatchObject({ kind: 'video', stars: 4, picked: true, duration: 6 });
  });
});
