import { describe, expect, it } from 'vitest';
import {
  attachMotion,
  bearing,
  compass16,
  firstIndexAtOrAfter,
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
  motionAt,
  SPEED_UNITS,
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

/**
 * A 3-second track sampled every 100 ms. `latAt` returns the latitude at a
 * given time, so a test can decide when the aircraft starts moving.
 */
function trackOf(latAt: (t: number) => number, altAt: (t: number) => number = () => 10): Cue[] {
  const cues: Cue[] = [];
  for (let k = 0; k <= 30; k++) {
    const t = Number((k * 0.1).toFixed(3));
    cues.push(cue(t, latAt(t), -61, altAt(t)));
  }
  return cues;
}

/** Flying due north at 0.001°/s ≈ 111 m/s, from the very first frame. */
const northbound = (t: number) => 16 + t * 0.001;

describe('firstIndexAtOrAfter', () => {
  it('mirrors lastIndexAtOrBefore, and reports -1 past the end', () => {
    const cues = trackOf(northbound);
    expect(firstIndexAtOrAfter(cues, 0)).toBe(0);
    expect(firstIndexAtOrAfter(cues, 1)).toBe(10);
    expect(firstIndexAtOrAfter(cues, 0.95)).toBe(10);
    expect(firstIndexAtOrAfter(cues, 99)).toBe(-1);
  });
});

describe('attachMotion — the opening window measured forward', () => {
  it('gives the first cue the reading it is about to have', () => {
    const cues = trackOf(northbound, (t) => 10 + t * 2);
    attachMotion(cues);

    // Nothing backwards, as before…
    expect(cues[0].derived).toEqual({});
    // …but the coming second is a real measurement.
    expect(cues[0].lead?.groundSpeed).toBeCloseTo(111.2, 0);
    expect(cues[0].lead?.verticalSpeed).toBeCloseTo(2, 3);
    expect(cues[0].lead?.heading).toBeCloseTo(0, 1);
  });

  it('attaches nothing where the look-back already answers', () => {
    const cues = trackOf(northbound);
    attachMotion(cues);
    expect(cues[0].lead).toBeDefined(); // 0 s — no past at all
    expect(cues[2].lead).toBeDefined(); // 0.2 s — span still too short to trust
    expect(cues[3].lead).toBeUndefined(); // 0.3 s — the look-back is enough
  });

  it('reaches no further than the opening window', () => {
    // Hovering for two seconds, then off to the north. A mid-clip gap belongs
    // to the gap policies (heading-smooth.ts): carrying the bearing backwards
    // into it would announce the turn before it happens.
    const cues = trackOf((t) => (t < 2 ? 16 : 16 + (t - 2) * 0.001));
    attachMotion(cues);
    expect(cues[15].derived?.heading).toBeUndefined();
    expect(cues[15].lead).toBeUndefined();
  });

  it('never overwrites a value the look-back could measure', () => {
    // Still for 0.6 s, then off to the north: at 0.5 s the backward window
    // honestly reads 0 m/s, while the window ahead is already moving.
    const cues = trackOf((t) => (t < 0.6 ? 16 : 16 + (t - 0.6) * 0.001));
    attachMotion(cues);

    const at = cues[5];
    expect(at.start).toBeCloseTo(0.5, 3);
    expect(at.derived?.groundSpeed).toBeCloseTo(0, 3);
    expect(at.derived?.heading).toBeUndefined();
    // The measured 0 wins; only the missing heading comes from ahead.
    expect(motionAt(at).groundSpeed).toBeCloseTo(0, 3);
    expect(motionAt(at).heading).toBeCloseTo(0, 1);
  });

  it('invents nothing for an aircraft that stays put', () => {
    const cues = trackOf(() => 16);
    attachMotion(cues);
    expect(motionAt(cues[0]).heading).toBeUndefined();
    expect(motionAt(cues[0]).groundSpeed).toBeCloseTo(0, 3);
  });
});

describe('motionAt', () => {
  it('fills the missing values from ahead, or nothing when asked', () => {
    const cues = trackOf(northbound);
    attachMotion(cues);

    expect(motionAt(cues[0]).groundSpeed).toBeCloseTo(111.2, 0);
    expect(motionAt(cues[0], false)).toEqual({});
    expect(motionAt(null)).toEqual({});
  });

  it('is a plain read of `derived` outside the opening window', () => {
    const cues = trackOf(northbound);
    attachMotion(cues);
    expect(motionAt(cues[20])).toBe(cues[20].derived);
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

  it('converts into every offered unit, sign kept', () => {
    // 10 m/s = 36 km/h = 22.4 mph
    expect(formatGroundSpeed(10, 'km/h')).toBe('36.0 km/h');
    expect(formatGroundSpeed(10, 'mph')).toBe('22.4 mph');
    expect(formatVerticalSpeed(-2, 'mph')).toBe('-4.5 mph');
    expect(formatVerticalSpeed(2, 'km/h')).toBe('+7.2 km/h');
    expect(SPEED_UNITS).toEqual(['m/s', 'km/h', 'mph']);
  });

  it('formats heading as degrees plus compass point', () => {
    expect(formatHeading(0)).toBe('0° N');
    expect(formatHeading(90)).toBe('90° E');
    expect(formatHeading(247.5)).toBe('248° WSW');
    expect(formatHeading(undefined)).toBeUndefined();
  });
});
