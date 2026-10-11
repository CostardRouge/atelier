import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flightSummary } from './flight-summary';
import { parseSrt, type Cue } from './srt-parser';

const cue = (start: number, data: Record<string, string>): Cue => ({ start, end: start + 1, frame: null, timestamp: null, data });

describe('flightSummary', () => {
  it('reads a real log: seconds, kilometres, the highest point, the start', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../tests/fixtures/sample.srt', import.meta.url)), 'utf8');
    const s = flightSummary(parseSrt(text));
    expect(s.seconds).toBeGreaterThan(0);
    expect(s.km).not.toBeNull();
    expect(s.maxHeightM).toBeGreaterThanOrEqual(35.2);
    expect(s.start).toEqual({ lat: 16.05687, lon: -61.748979 });
  });

  it('says nothing of what the log does not carry', () => {
    expect(flightSummary([])).toEqual({ seconds: 0, km: null, maxHeightM: null, start: null });
    expect(flightSummary([cue(0, { iso: '100' }), cue(1, { iso: '100' })])).toEqual({ seconds: 2, km: null, maxHeightM: null, start: null });
    const one = flightSummary([cue(0, { latitude: '16', longitude: '-61', rel_alt: '12' })]);
    expect(one).toEqual({ seconds: 1, km: null, maxHeightM: 12, start: { lat: 16, lon: -61 } });
  });

  it('adds the ground distance along the located cues', () => {
    const s = flightSummary([cue(0, { latitude: '1', longitude: '0' }), cue(1, { latitude: '1', longitude: '0.01' }), cue(2, { latitude: '1', longitude: '0.02' })]);
    expect(s.km).toBeCloseTo(2.22, 1);
  });
});
