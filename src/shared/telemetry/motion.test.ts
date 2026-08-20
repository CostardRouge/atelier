import { describe, expect, it } from 'vitest';
import {
  attachMotion,
  bearing,
  compass16,
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
  haversine,
} from './motion';
import type { Cue } from './srt-parser';

/** Build a minimal cue with just the fields the motion math reads. */
function cue(
  start: number,
  lat: number,
  lon: number,
  relAlt: number,
): Cue {
  return {
    start,
    end: start,
    frame: null,
    timestamp: null,
    data: {
      latitude: String(lat),
      longitude: String(lon),
      rel_alt: String(relAlt),
    },
  };
}

describe('haversine', () => {
  it('measures ~111.3 m for 0.001° of latitude', () => {
    expect(haversine(16, -61, 16.001, -61)).toBeCloseTo(111.2, 0);
  });

  it('is zero for identical points', () => {
    expect(haversine(16, -61, 16, -61)).toBe(0);
  });
});

describe('bearing', () => {
  it('reads 0° due north', () => {
    expect(bearing(16, -61, 16.001, -61)).toBeCloseTo(0, 1);
  });

  it('reads ~90° due east', () => {
    expect(bearing(16, -61, 16, -60.999)).toBeCloseTo(90, 1);
  });

  it('reads ~180° due south', () => {
    expect(bearing(16, -61, 15.999, -61)).toBeCloseTo(180, 1);
  });

  it('reads ~270° due west', () => {
    expect(bearing(16, -61, 16, -61.001)).toBeCloseTo(270, 1);
  });
});

describe('compass16', () => {
  it('maps cardinals and intercardinals', () => {
    expect(compass16(0)).toBe('N');
    expect(compass16(90)).toBe('E');
    expect(compass16(180)).toBe('S');
    expect(compass16(270)).toBe('W');
    expect(compass16(45)).toBe('NE');
    expect(compass16(247.5)).toBe('WSW');
  });

  it('wraps angles outside [0,360)', () => {
    expect(compass16(360)).toBe('N');
    expect(compass16(-90)).toBe('W');
  });
});

describe('attachMotion', () => {
  it('derives speed, climb and heading over the look-back window', () => {
    // Two points 1 s apart: ~111 m north and +2 m altitude.
    const cues = [cue(0, 16, -61, 10), cue(1, 16.001, -61, 12)];
    attachMotion(cues);

    expect(cues[1].derived?.groundSpeed).toBeCloseTo(111.2, 0);
    expect(cues[1].derived?.verticalSpeed).toBeCloseTo(2, 3);
    expect(cues[1].derived?.heading).toBeCloseTo(0, 1);
  });

  it('leaves the first cue without a predecessor empty', () => {
    const cues = [cue(0, 16, -61, 10), cue(1, 16.001, -61, 12)];
    attachMotion(cues);
    expect(cues[0].derived).toEqual({});
  });

  it('suppresses heading while hovering but still reports the climb rate', () => {
    // Same coordinates, only altitude changes → no direction of travel.
    const cues = [cue(0, 16, -61, 10), cue(1, 16, -61, 13)];
    attachMotion(cues);

    expect(cues[1].derived?.heading).toBeUndefined();
    expect(cues[1].derived?.groundSpeed).toBeCloseTo(0, 3);
    expect(cues[1].derived?.verticalSpeed).toBeCloseTo(3, 3);
  });

  it('does not derive when the spanned time is too short to trust', () => {
    // 16 ms apart (one 60 fps frame) → below the minimum window.
    const cues = [cue(0, 16, -61, 10), cue(0.016, 16.001, -61, 12)];
    attachMotion(cues);
    expect(cues[1].derived).toEqual({});
  });
});

describe('motion formatters', () => {
  it('formats ground speed to one decimal with units', () => {
    expect(formatGroundSpeed(12.34)).toBe('12.3 m/s');
    expect(formatGroundSpeed(undefined)).toBeUndefined();
  });

  it('signs vertical speed and collapses near-zero', () => {
    expect(formatVerticalSpeed(2)).toBe('+2.0 m/s');
    expect(formatVerticalSpeed(-0.8)).toBe('-0.8 m/s');
    expect(formatVerticalSpeed(0.02)).toBe('0.0 m/s');
    expect(formatVerticalSpeed(undefined)).toBeUndefined();
  });

  it('formats heading as degrees plus compass point', () => {
    expect(formatHeading(0)).toBe('0° N');
    expect(formatHeading(90)).toBe('90° E');
    expect(formatHeading(247.5)).toBe('248° WSW');
    expect(formatHeading(undefined)).toBeUndefined();
  });
});
