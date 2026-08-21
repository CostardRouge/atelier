import { describe, expect, it } from 'vitest';
import {
  attachMotion,
  retimeCues,
  bearing,
  compass16,
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
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

describe('attachMotion under a conform', () => {
  /** Ten seconds of media, one cue every 0.1 s, moving due east at a steady rate. */
  function eastbound(): Cue[] {
    const cues: Cue[] = [];
    for (let i = 0; i <= 100; i++) {
      // 0.0001° of longitude at this latitude is ~10.7 m; one step per 0.1 s.
      cues.push(cue(i / 10, 16, -61 + i * 0.0001, 35));
    }
    return cues;
  }

  it('reads the same ground speed whatever cadence the clip was conformed to', () => {
    const real = eastbound();
    attachMotion(real);
    const atSpeed = real[80].derived?.groundSpeed ?? 0;
    expect(atSpeed).toBeGreaterThan(0);

    // The same flight shot at 4× and laid down slowed: identical positions, but
    // every cue four times further apart on the file's timeline.
    const slow = eastbound().map((c) => ({ ...c, start: c.start * 4, end: c.end * 4 }));
    attachMotion(slow, 0.25);
    expect(slow[80].derived?.groundSpeed).toBeCloseTo(atSpeed, 6);
  });

  it('under-reports by exactly the conform factor when the scale is ignored', () => {
    const slow = eastbound().map((c) => ({ ...c, start: c.start * 4, end: c.end * 4 }));
    attachMotion(slow, 1);
    const wrong = slow[80].derived?.groundSpeed ?? 0;
    attachMotion(slow, 0.25);
    const right = slow[80].derived?.groundSpeed ?? 0;
    expect(right / wrong).toBeCloseTo(4, 6);
  });

  it('leaves the heading alone — an azimuth does not care about time', () => {
    const slow = eastbound().map((c) => ({ ...c, start: c.start * 4, end: c.end * 4 }));
    attachMotion(slow, 1);
    const uncorrected = slow[80].derived?.heading ?? 0;
    attachMotion(slow, 0.25);
    const corrected = slow[80].derived?.heading ?? 0;
    // Both read due east. They differ in the last ten-thousandth of a degree
    // because the corrected window looks back over four times as much track,
    // so the great-circle bearing is taken between a different pair of fixes —
    // not because the conform turned the aircraft.
    expect(uncorrected).toBeCloseTo(90, 3);
    expect(corrected).toBeCloseTo(90, 3);
  });

  it('scales the vertical speed the same way', () => {
    const climbing = eastbound().map((c, i) => ({
      ...c,
      start: c.start * 4,
      end: c.end * 4,
      data: { ...c.data, rel_alt: String(35 + i * 0.2) },
    }));
    attachMotion(climbing, 0.25);
    // 0.2 m per 0.1 s of capture time = 2 m/s, whatever the file's timeline says.
    expect(climbing[80].derived?.verticalSpeed).toBeCloseTo(2, 1);
  });

  it('re-deriving is idempotent, never compounding', () => {
    const cues = eastbound();
    attachMotion(cues, 0.25);
    const once = cues[80].derived?.groundSpeed;
    attachMotion(cues, 0.25);
    expect(cues[80].derived?.groundSpeed).toBe(once);
  });
});

describe('retimeCues', () => {
  it('answers with a new list and leaves the original untouched', () => {
    const cues = [
      cue(0, 16, -61, 35),
      cue(1, 16, -60.9999, 35),
      cue(2, 16, -60.9998, 35),
    ];
    attachMotion(cues);
    const before = cues[2].derived?.groundSpeed;
    const retimed = retimeCues(cues, 0.5);
    expect(retimed).not.toBe(cues);
    expect(retimed[2]).not.toBe(cues[2]);
    expect(cues[2].derived?.groundSpeed).toBe(before);
    expect(retimed[2].derived?.groundSpeed).toBeCloseTo((before ?? 0) * 2, 6);
  });
});
