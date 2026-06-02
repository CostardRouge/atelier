import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSrt } from './srt-parser';

const fixture = readFileSync(
  fileURLToPath(new URL('../../../tests/fixtures/sample.srt', import.meta.url)),
  'utf-8',
);

describe('parseSrt', () => {
  const cues = parseSrt(fixture);

  it('returns 3 cues for the fixture', () => {
    expect(cues).toHaveLength(3);
  });

  it('parses cue timing in seconds', () => {
    expect(cues[0].start).toBe(0);
    expect(cues[0].end).toBeCloseTo(0.016, 3);
  });

  it('parses FrameCnt', () => {
    expect(cues[0].frame).toBe(1);
    expect(cues[1].frame).toBe(2);
    expect(cues[2].frame).toBe(3);
  });

  it('parses the capture timestamp', () => {
    expect(cues[0].timestamp).toBe('2026-05-30 05:49:34.609');
  });

  // Anti-regression: the double-pair bracket `[rel_alt: ... abs_alt: ...]`
  // must split into two distinct fields. Indispensable.
  it('splits the double-pair rel_alt/abs_alt bracket', () => {
    expect(cues[0].data.rel_alt).toBe('35.200');
    expect(cues[0].data.abs_alt).toBe('80.196');
  });

  it('parses single-pair fields', () => {
    expect(cues[0].data.iso).toBe('100');
    expect(cues[0].data.latitude).toBe('16.056870');
    expect(cues[0].data.longitude).toBe('-61.748979');
    expect(cues[0].data.shutter).toBe('1/500.0');
    expect(cues[0].data.fnum).toBe('1.7');
    expect(cues[0].data.ev).toBe('0');
    expect(cues[0].data.color_md).toBe('dlog_m');
    expect(cues[0].data.focal_len).toBe('24.00');
    expect(cues[0].data.ct).toBe('5300');
  });

  it('never leaks <font> tags into any value', () => {
    for (const cue of cues) {
      for (const value of Object.values(cue.data)) {
        expect(value).not.toMatch(/<|>|font/);
      }
    }
  });

  it('returns cues sorted by ascending start', () => {
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].start);
    }
  });

  it('returns an empty array for unsupported/empty input', () => {
    expect(parseSrt('')).toEqual([]);
    expect(parseSrt('not an srt file at all')).toEqual([]);
  });
});
