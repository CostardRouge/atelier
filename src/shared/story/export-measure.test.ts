import { describe, expect, it } from 'vitest';
import { deviceLabel, measureLine, profileOf, readMeasures, speedOf, withMeasure, type ExportMeasure } from './export-measure';

const m = (over: Partial<ExportMeasure> = {}): ExportMeasure => ({
  at: 0,
  post: 'EP.00',
  seconds: 23.2,
  wallMs: 18_000,
  frames: 696,
  fps: 30,
  video: 'avc1.640028',
  audio: 'aac',
  bytes: 14.2 * 1_048_576,
  peakHeapMb: 812.4,
  device: 'Mac · Chrome 131 (10 cores)',
  outcome: 'done',
  ...over,
});

describe('export measures', () => {
  it('says speed, profile, sound, weight, heap and device on one line', () => {
    expect(speedOf(m())).toBeCloseTo(1.289, 2);
    expect(measureLine(m())).toBe('EP.00 · 23.2 s of video in 18 s (1.29× real time) · H.264 High + AAC · 14.2 MB · heap ≤ 812 MB · Mac · Chrome 131 (10 cores)');
    expect(measureLine(m({ outcome: 'cancelled', wallMs: 4200 }))).toBe('EP.00 · cancelled after 4.2 s · Mac · Chrome 131 (10 cores)');
    expect(measureLine(m({ audio: null, peakHeapMb: null, bytes: null }))).toContain('+ silent · Mac');
  });
  it('names H.264 profiles', () => {
    expect(profileOf('avc1.4d0028')).toBe('H.264 Main');
    expect(profileOf('avc1.42001f')).toBe('H.264 Baseline');
    expect(profileOf(null)).toBe('no video');
  });
  it('keeps the newest few, and reads back only measures', () => {
    let list: ExportMeasure[] = [];
    for (let i = 0; i < 15; i++) list = withMeasure(list, m({ at: i }));
    expect(list).toHaveLength(12);
    expect(list[0].at).toBe(14);
    expect(readMeasures([m(), { nope: 1 }, 'x'])).toHaveLength(1);
    expect(readMeasures(null)).toEqual([]);
  });
  it('labels a device without identifying it', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 10, 8)).toBe('Mac · Chrome 131 (10 cores, 8 GB)');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari 18');
  });
});
