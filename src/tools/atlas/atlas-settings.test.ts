import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../shared/lib/prng';
import { DEFAULT_SETTINGS, LOOK_PRESETS, MOTION_PRESETS, aspectRatio, mapRect, mapUnitFrame, resolvedClock, sanitizeSettings, surpriseLook } from './atlas-settings';
import { flightTone, parseHex, samplePalette, sampleCyclic, toHex } from './atlas-colour';
import { counterLine, formatDate, formatDateRange, formatElapsed, formatTimeOfDay } from './atlas-hud';

describe('sanitizeSettings', () => {
  it('gives the defaults for nothing, and keeps the defaults whole', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads the outro’s old totals switch as its chosen totals', () => {
    expect(sanitizeSettings({ outro: { totals: false } }).outro.stats).toEqual([]);
    expect(sanitizeSettings({ outro: { totals: true } }).outro.stats).toEqual(DEFAULT_SETTINGS.outro.stats);
    expect(sanitizeSettings({ outro: { stats: ['places', 'flights', 'warp'], columns: 5 } }).outro).toMatchObject({ stats: ['flights', 'places'], columns: 2 });
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

  it('keeps a sticker and its weights, and refuses what they cannot be', () => {
    const s = sanitizeSettings({
      hud: { sticker: { style: 'logo', ink: 'neon', backing: 'plate', size: 500, maker: 'Autel', logoTint: 'yes' } },
      aircraft: { weights: { 'DJI Mini 4 Pro': 1.6, 'DJI Air 3S': 'two', 'DJI Flip': 40 } },
    });
    expect(s.hud.sticker).toEqual({ style: 'logo', ink: 'auto', backing: 'plate', size: 80, maker: 'Autel', logoTint: true });
    expect(s.aircraft.weights).toEqual({ 'DJI Mini 4 Pro': 2, 'DJI Flip': 12 });
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

describe('the frame and the overlay style', () => {
  it('moves an old root aspect into the format, and refuses a broken theme field by field', () => {
    const s = sanitizeSettings({ aspect: '9:16', hud: { theme: { presetId: 'or-cine', style: { color: 'gold', weight: 650, fontFamily: 'Comic Sans' } } } });
    expect(s.format.aspect).toBe('9:16');
    expect(s.hud.theme.presetId).toBe('or-cine');
    expect(s.hud.theme.style.fontFamily).toBe('Instrument Serif');
    expect(s.hud.theme.style.weight).toBe(400);
    expect(s.hud.theme.style.color).toBe('#f2c230');
    expect(sanitizeSettings({ camera: { zone: { x0: 1, y0: 0, x1: 0, y1: 1 } } }).camera.zone).toBeNull();
  });

  it('lays the map inside its border and band', () => {
    const f = { ...DEFAULT_SETTINGS.format, aspect: '4:5' as const, border: 0.05, band: 0.2 };
    expect(mapRect(f, 1080, 1350)).toEqual({ x: 54, y: 54, w: 972, h: 1350 - 108 - 216 });
    const u = mapUnitFrame(f);
    expect(u.w).toBeCloseTo(0.9, 9);
    expect(u.h).toBeCloseTo(1.25 - 0.1 - 0.2, 9);
  });

  it('words a date range', () => {
    expect(formatDateRange([null])).toBeNull();
    expect(formatDateRange([Date.UTC(2026, 4, 30, 9)])).toBe('30 May 2026');
    expect(formatDateRange([Date.UTC(2026, 4, 12), Date.UTC(2026, 4, 30)])).toBe('12 – 30 May 2026');
    expect(formatDateRange([Date.UTC(2026, 0, 12), null, Date.UTC(2026, 4, 30)])).toBe('12 Jan – 30 May 2026');
    expect(formatDateRange([Date.UTC(2025, 11, 31), Date.UTC(2026, 0, 2)])).toBe('31 Dec 2025 – 2 Jan 2026');
  });
});
