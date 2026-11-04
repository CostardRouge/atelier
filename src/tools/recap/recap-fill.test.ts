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
