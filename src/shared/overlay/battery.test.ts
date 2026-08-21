import { describe, expect, it } from 'vitest';
import { batteryFromCue, batteryLevel, parseBatteryValue } from './battery';
import { createBatteryElement } from './overlay-types';
import type { Cue } from '../telemetry/srt-parser';

function cue(data: Record<string, string>): Cue {
  return { start: 0, end: 1, frame: 1, timestamp: null, data, derived: {} };
}

describe('parseBatteryValue', () => {
  it('reads plain percentages, with or without the sign', () => {
    expect(parseBatteryValue('87')).toBe(87);
    expect(parseBatteryValue('87%')).toBe(87);
    expect(parseBatteryValue(' 100 ')).toBe(100);
    expect(parseBatteryValue('0')).toBe(0);
  });

  it('reads a 0..1 fraction as a percentage', () => {
    expect(parseBatteryValue('0.42')).toBeCloseTo(42, 6);
    // 1 is a nearly-flat pack on a 0..100 scale, not a full one.
    expect(parseBatteryValue('1')).toBe(1);
  });

  it('refuses anything that is not a percentage', () => {
    expect(parseBatteryValue(undefined)).toBeNull();
    expect(parseBatteryValue('')).toBeNull();
    expect(parseBatteryValue('n/a')).toBeNull();
    expect(parseBatteryValue('-5')).toBeNull();
    expect(parseBatteryValue('130')).toBeNull();
  });
});

describe('batteryFromCue', () => {
  it('finds a battery key whatever its spelling', () => {
    expect(batteryFromCue(cue({ battery: '64' }))).toBe(64);
    expect(batteryFromCue(cue({ battery_percent: '64' }))).toBe(64);
    expect(batteryFromCue(cue({ BatteryLevel: '64' }))).toBe(64);
    expect(batteryFromCue(cue({ 'remain-battery': '64' }))).toBe(64);
  });

  it('honours an explicitly named key and ignores the rest', () => {
    const c = cue({ battery: '10', my_pack: '90' });
    expect(batteryFromCue(c, 'my_pack')).toBe(90);
    expect(batteryFromCue(c, 'nothing_here')).toBeNull();
  });

  it('yields nothing for a real DJI cue — the sidecar carries no battery', () => {
    const dji = cue({
      iso: '100',
      shutter: '1/500.0',
      fnum: '1.7',
      rel_alt: '35.200',
      latitude: '16.056870',
    });
    expect(batteryFromCue(dji)).toBeNull();
    expect(batteryFromCue(null)).toBeNull();
  });
});

describe('batteryLevel', () => {
  it('uses the authored value in manual mode, clamped', () => {
    const el = createBatteryElement();
    expect(batteryLevel(el, null)).toBe(el.batteryPercent);
    expect(batteryLevel({ ...el, batteryPercent: 140 }, null)).toBe(100);
    expect(batteryLevel({ ...el, batteryPercent: -3 }, null)).toBe(0);
    expect(batteryLevel({ ...el, batteryPercent: undefined }, null)).toBeNull();
  });

  it('never falls back to a made-up level when telemetry has none', () => {
    const el = { ...createBatteryElement(), batterySource: 'telemetry' as const };
    expect(batteryLevel(el, cue({ iso: '100' }))).toBeNull();
    expect(batteryLevel(el, cue({ battery: '55' }))).toBe(55);
  });
});
