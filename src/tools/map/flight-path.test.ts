import { describe, expect, it } from 'vitest';
import type { Cue } from '../telemetry/srt-parser';
import {
  extractTrack,
  lineCoordinates,
  parsePosition,
  trackBounds,
} from './flight-path';

/** Minimal cue builder — only the fields the flight path reads. */
function cue(
  start: number,
  latitude?: string,
  longitude?: string,
  rel_alt?: string,
): Cue {
  return {
    start,
    end: start + 0.033,
    frame: null,
    timestamp: null,
    data: { latitude, longitude, rel_alt },
  };
}

describe('parsePosition', () => {
  it('returns [lon, lat] for a valid fix', () => {
    expect(parsePosition(cue(0, '37.7749', '-122.4194'))).toEqual([-122.4194, 37.7749]);
  });

  it('rejects a null-island (0,0) fix and out-of-range / missing values', () => {
    expect(parsePosition(cue(0, '0', '0'))).toBeNull();
    expect(parsePosition(cue(0, '200', '10'))).toBeNull();
    expect(parsePosition(cue(0, undefined, undefined))).toBeNull();
  });
});

describe('extractTrack', () => {
  const cues = [
    cue(0, '0', '0'), // pre-lock, dropped
    cue(1, '48.8566', '2.3522', '12.5'),
    cue(2, '48.8570', '2.3530', '20'),
    cue(3, 'nan', 'nan'), // garbage, dropped
  ];
  const track = extractTrack(cues);

  it('keeps only located cues, in order, with time and altitude', () => {
    expect(track).toHaveLength(2);
    expect(track[0]).toEqual({ lon: 2.3522, lat: 48.8566, t: 1, alt: 12.5 });
    expect(track[1].t).toBe(2);
    expect(track[1].alt).toBe(20);
  });

  it('records altitude as null when absent', () => {
    const t = extractTrack([cue(0, '48.0', '2.0')]);
    expect(t[0].alt).toBeNull();
  });
});

describe('trackBounds / lineCoordinates', () => {
  const track = extractTrack([
    cue(0, '48.8566', '2.3522'),
    cue(1, '48.8600', '2.3500'),
  ]);

  it('computes the bounding box as [lon, lat]', () => {
    expect(trackBounds(track)).toEqual({
      min: [2.35, 48.8566],
      max: [2.3522, 48.86],
    });
  });

  it('returns null bounds for an empty track', () => {
    expect(trackBounds([])).toBeNull();
  });

  it('produces GeoJSON [lon, lat] coordinates', () => {
    expect(lineCoordinates(track)).toEqual([
      [2.3522, 48.8566],
      [2.35, 48.86],
    ]);
  });
});
