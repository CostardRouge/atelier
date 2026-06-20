import { describe, expect, it } from 'vitest';
import type { Cue } from '../telemetry/srt-parser';
import { buildLines, DEFAULT_OVERLAY, hexToRgba } from './overlay';

function cue(): Cue {
  return {
    start: 0,
    end: 0.03,
    frame: null,
    timestamp: null,
    data: { rel_alt: '35.2', latitude: '48.8566', longitude: '2.3522' },
    derived: { groundSpeed: 5, verticalSpeed: 0, heading: 90 },
  };
}

describe('buildLines', () => {
  it('includes active fields, skipping missing values', () => {
    const lines = buildLines(cue(), DEFAULT_OVERLAY);
    // Labels are off by default → bare values, altitude first.
    expect(lines[0]).toBe('35.2 m');
    expect(lines).toContain('48.8566, 2.3522');
    // V/S is on by default → present.
    expect(lines).toContain('0.0 m/s');
  });

  it('adds the prefix when labels are on', () => {
    const lines = buildLines(cue(), { ...DEFAULT_OVERLAY, labels: true });
    expect(lines[0]).toBe('ALT 35.2 m');
    expect(lines).toContain('GPS 48.8566, 2.3522');
  });

  it('honours the active-field set', () => {
    const lines = buildLines(cue(), {
      ...DEFAULT_OVERLAY,
      labels: true,
      fields: { altitude: true, speed: false, heading: false, coords: false },
    });
    expect(lines).toEqual(['ALT 35.2 m']);
  });

  it('returns nothing for an empty cue', () => {
    expect(buildLines(null, DEFAULT_OVERLAY)).toEqual([]);
  });
});

describe('hexToRgba', () => {
  it('expands 6- and 3-digit hex with alpha', () => {
    expect(hexToRgba('#ffffff', 0.5)).toBe('rgba(255,255,255,0.5)');
    expect(hexToRgba('#000', 1)).toBe('rgba(0,0,0,1)');
    expect(hexToRgba('#d9442a', 1)).toBe('rgba(217,68,42,1)');
  });

  it('falls back to black on a bad hex', () => {
    expect(hexToRgba('nope', 0.3)).toBe('rgba(0,0,0,0.3)');
  });
});
