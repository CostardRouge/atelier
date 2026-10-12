import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../shared/lib/prng';
import { DEFAULT_SETTINGS, LOOK_PRESETS, MOTION_PRESETS, aspectRatio, resolvedClock, sanitizeSettings, surpriseLook } from './atlas-settings';
import { flightTone, parseHex, samplePalette, sampleCyclic, toHex } from './atlas-colour';
import { counterLine, formatDate, formatElapsed, formatTimeOfDay } from './atlas-hud';

describe('sanitizeSettings', () => {
  it('gives the defaults for nothing, and keeps the defaults whole', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps, refuses the wrong type and drops what it does not know', () => {
    const s = sanitizeSettings({
      choreo: { mode: 'warp', length: 9999, equalize: -3 },
      colour: { trail: 'red', palette: 'neon' },
      junk: 1,
    });
    expect(s.choreo.mode).toBe(DEFAULT_SETTINGS.choreo.mode);
    expect(s.choreo.length).toBe(600);
    expect(s.choreo.equalize).toBe(0);
    expect(s.colour.trail).toBe(DEFAULT_SETTINGS.colour.trail);
    expect(s.colour.palette).toBe('neon');
    expect('junk' in s).toBe(false);
  });

  it('every preset gives settings that survive sanitising', () => {
    for (const p of [...LOOK_PRESETS, ...MOTION_PRESETS]) {
      const s = p.apply(DEFAULT_SETTINGS);
      expect(sanitizeSettings(s)).toEqual(s);
    }
    const surprise = surpriseLook(DEFAULT_SETTINGS, mulberry32(3));
    expect(sanitizeSettings(surprise).colour.palette).toBe(surprise.colour.palette);
  });

  it('a look leaves the motion alone, and the other way round', () => {
    const moved = MOTION_PRESETS[3].apply(DEFAULT_SETTINGS);
    const dressed = LOOK_PRESETS[2].apply(moved);
    expect(dressed.choreo).toEqual(moved.choreo);
  });
});

describe('small readings', () => {
  it('aspect and the auto clock', () => {
    expect(aspectRatio('9:16')).toBeCloseTo(0.5625, 9);
    expect(resolvedClock('auto', 'clock')).toBe('time');
    expect(resolvedClock('auto', 'calendar')).toBe('datetime');
    expect(resolvedClock('auto', 'cascade')).toBe('elapsed');
    expect(resolvedClock('date', 'cascade')).toBe('date');
  });

  it('colours', () => {
    expect(toHex(parseHex('#5fd3e6'))).toBe('#5fd3e6');
    expect(toHex(samplePalette(['#000000', '#ffffff'], 0.5))).toBe('#808080');
    expect(toHex(sampleCyclic(['#000000', '#ffffff'], 1))).toBe('#000000');
    expect(flightTone(0)).toBe(0);
    expect(Math.abs(flightTone(1) - flightTone(2))).toBeGreaterThan(0.2);
  });

  it('the corner text', () => {
    expect(formatTimeOfDay(Date.UTC(2026, 0, 1, 6, 11))).toBe('6:11 am');
    expect(formatTimeOfDay(Date.UTC(2026, 0, 1, 0, 5))).toBe('12:05 am');
    expect(formatTimeOfDay(Date.UTC(2026, 0, 1, 14, 0))).toBe('2:00 pm');
    expect(formatDate(Date.UTC(2026, 4, 30))).toBe('30 May 2026');
    expect(formatElapsed(65.9)).toBe('1:05');
    expect(counterLine(413, 'buses running')).toBe('413 buses running');
    expect(counterLine(1, 'drones flying')).toBe('1 drone flying');
    expect(counterLine(1, 'flying')).toBe('1 flying');
  });
});
