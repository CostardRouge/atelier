import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSrt } from './srt-parser';
import { summarizeTelemetry } from './telemetry-summary';

const fixture = readFileSync(
  fileURLToPath(new URL('../../tests/fixtures/sample.srt', import.meta.url)),
  'utf-8',
);

describe('summarizeTelemetry', () => {
  const summary = summarizeTelemetry(parseSrt(fixture));

  it('counts cues', () => {
    expect(summary.cueCount).toBe(3);
  });

  it('computes rel_alt min/max', () => {
    expect(summary.relAltMin).toBeCloseTo(35.2, 3);
    expect(summary.relAltMax).toBeCloseTo(35.2, 3);
  });

  it('takes coordinates from the first cue', () => {
    expect(summary.startLatitude).toBe('16.056870');
    expect(summary.startLongitude).toBe('-61.748979');
  });

  it('reports the color profile', () => {
    expect(summary.colorProfile).toBe('dlog_m');
  });

  it('returns a zeroed summary for an empty track', () => {
    const empty = summarizeTelemetry([]);
    expect(empty.cueCount).toBe(0);
    expect(empty.relAltMin).toBeNull();
    expect(empty.relAltMax).toBeNull();
    expect(empty.startLatitude).toBeNull();
    expect(empty.colorProfile).toBeNull();
  });
});
