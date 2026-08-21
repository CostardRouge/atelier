import { describe, expect, it } from 'vitest';
import {
  describeExportRun,
  describeExportStat,
  formatElapsed,
  formatSpeed,
  totalExportStats,
  type ExportStat,
} from './export-stats';

const stat = (over: Partial<ExportStat> = {}): ExportStat => ({
  bytes: 412_800_000,
  seconds: 108,
  clipSeconds: 120,
  ...over,
});

describe('formatElapsed', () => {
  it('keeps a decimal under ten seconds, where it is the difference', () => {
    expect(formatElapsed(8.34)).toBe('8.3 s');
    expect(formatElapsed(0.4)).toBe('0.4 s');
  });
  it('rounds to whole seconds under a minute', () => {
    expect(formatElapsed(41.4)).toBe('41 s');
    expect(formatElapsed(59.6)).toBe('60 s');
  });
  it('splits minutes and seconds, padded so the column lines up', () => {
    expect(formatElapsed(108)).toBe('1 min 48 s');
    expect(formatElapsed(125)).toBe('2 min 05 s');
    expect(formatElapsed(3599)).toBe('59 min 59 s');
  });
  it('drops to hours and minutes past an hour', () => {
    expect(formatElapsed(3600)).toBe('1 h 00 min');
    expect(formatElapsed(3900)).toBe('1 h 05 min');
  });
  it('refuses to invent a figure for nonsense', () => {
    expect(formatElapsed(Number.NaN)).toBe('—');
    expect(formatElapsed(-1)).toBe('—');
  });
});

describe('formatSpeed', () => {
  it('reads as a multiple of realtime', () => {
    expect(formatSpeed(120, 108)).toBe('1.1× realtime');
    expect(formatSpeed(120, 41)).toBe('2.9× realtime');
  });
  it('drops the decimal once the ratio is large', () => {
    expect(formatSpeed(600, 40)).toBe('15× realtime');
  });
  it('says nothing rather than guessing without a clip duration', () => {
    expect(formatSpeed(null, 108)).toBeNull();
    expect(formatSpeed(0, 108)).toBeNull();
    expect(formatSpeed(120, 0)).toBeNull();
  });
});

describe('describeExportStat', () => {
  it('reads size, time, then speed', () => {
    expect(describeExportStat(stat())).toBe('413 MB · 1 min 48 s · 1.1× realtime');
  });
  it('leaves the speed out entirely when the duration is unknown', () => {
    expect(describeExportStat(stat({ clipSeconds: null }))).toBe('413 MB · 1 min 48 s');
  });
});

describe('the run total', () => {
  it('sums bytes and seconds', () => {
    const stats = [stat(), stat({ bytes: 38_200_000, seconds: 41 })];
    expect(totalExportStats(stats)).toEqual({ bytes: 451_000_000, seconds: 149 });
    expect(describeExportRun(stats)).toBe('2 files · 451 MB · 2 min 29 s');
  });
  it('says "1 file" for a single variant', () => {
    expect(describeExportRun([stat()])).toBe('1 file · 413 MB · 1 min 48 s');
  });
  it('is empty-safe', () => {
    expect(totalExportStats([])).toEqual({ bytes: 0, seconds: 0 });
  });
});
