import { describe, expect, it } from 'vitest';
import type { ExifData } from './exif-parser';
import { exposureSummary } from './exif-summary';
import {
  CAMERA_FIELDS,
  LEGACY_CAMERA_FIELDS,
  cameraFacts,
  factsLine,
  isCameraField,
  pickFacts,
} from './camera-facts';

const DJI: ExifData = {
  make: 'DJI',
  model: 'FC8482',
  focalLength: 6.72,
  focalLength35: 24,
  fNumber: 1.7,
  exposureTime: 1 / 240,
  iso: 100,
  exposureBias: 0,
  relativeAltitude: 118.4,
};

const SONY: ExifData = {
  make: 'SONY',
  model: 'ILCE-7CM2',
  lensModel: 'FE 24-70mm F2.8 GM II',
  focalLength: 35,
  focalLength35: 35,
  fNumber: 4,
  exposureTime: 1 / 500,
  iso: 200,
  exposureBias: -0.3,
};

const PHONE: ExifData = {
  make: 'Apple',
  model: 'iPhone 15 Pro',
  lensModel: 'iPhone 15 Pro',
  focalLength: 6.765,
  fNumber: 1.78,
  exposureTime: 1 / 1200,
  iso: 64,
};

describe('cameraFacts', () => {
  it("draws the legacy fields into exposureSummary's very line", () => {
    // A badge that never chose a layout must not change by a character.
    for (const exif of [DJI, SONY, PHONE, {}, { model: 'X100V', make: 'FUJIFILM' }]) {
      expect(factsLine(cameraFacts(exif), LEGACY_CAMERA_FIELDS)).toBe(exposureSummary(exif));
    }
  });

  it('writes each fact the way the suite prints it', () => {
    const f = cameraFacts(SONY).facts;
    expect(f.body?.value).toBe('SONY ILCE-7CM2');
    expect(f.lens?.value).toBe('FE 24-70mm F2.8 GM II');
    expect(f.focal35?.value).toBe('35 mm');
    expect(f.aperture?.value).toBe('ƒ/4');
    expect(f.shutter?.value).toBe('1/500');
    expect(f.iso).toEqual({ field: 'iso', value: 'ISO 200', bare: '200' });
    expect(f.ev).toEqual({ field: 'ev', value: '−0.3 EV', bare: '−0.3' });
  });

  it('keeps both focal lengths apart — the equivalent is not derived', () => {
    const f = cameraFacts(DJI).facts;
    expect(f.focal?.value).toBe('6.72 mm');
    expect(f.focal35?.value).toBe('24 mm');
    expect(cameraFacts(PHONE).facts.focal35).toBeUndefined();
  });

  it('leaves a zero compensation out of the facts but keeps it for a meter', () => {
    const facts = cameraFacts(DJI);
    expect(facts.facts.ev).toBeUndefined();
    expect(facts.evStops).toBe(0);
    expect(cameraFacts(PHONE).evStops).toBeNull();
  });

  it("knows a drone's height above take-off, and nothing else does", () => {
    expect(cameraFacts(DJI).facts.altitude?.value).toBe('118 m');
    expect(cameraFacts(SONY).facts.altitude).toBeUndefined();
    expect(cameraFacts({ relativeAltitude: -3.6 }).facts.altitude?.value).toBe('−4 m');
  });

  it('drops a lens that only repeats the body', () => {
    const same = { ...PHONE, lensModel: 'Apple iPhone 15 Pro' };
    expect(cameraFacts(same).facts.lens).toBeUndefined();
    // …even once the body is renamed: it is the file's own words that repeat.
    expect(cameraFacts(same, { 'Apple iPhone 15 Pro': 'iPhone' }).facts.lens).toBeUndefined();
  });

  it('renames a body only from the table the author wrote', () => {
    const named = cameraFacts(DJI, { 'dji fc8482': 'DJI Mini 4 Pro' });
    expect(named.facts.body?.value).toBe('DJI Mini 4 Pro');
    expect(named.rawBody).toBe('DJI FC8482');
    expect(cameraFacts(DJI, { 'DJI FC8482': '   ' }).facts.body?.value).toBe('DJI FC8482');
    expect(cameraFacts(DJI, { Other: 'X' }).facts.body?.value).toBe('DJI FC8482');
  });

  it('says nothing about a picture that records nothing', () => {
    expect(cameraFacts(null).facts).toEqual({});
    expect(factsLine(cameraFacts(null), LEGACY_CAMERA_FIELDS)).toBe('');
  });
});

describe('pickFacts', () => {
  it("keeps the author's order, skips what is not recorded, counts a field once", () => {
    const picked = pickFacts(cameraFacts(SONY), ['iso', 'altitude', 'aperture', 'iso', 'body']);
    expect(picked.map((f) => f.field)).toEqual(['iso', 'aperture', 'body']);
  });
});

describe('CAMERA_FIELDS', () => {
  it('names every field once, and recognises only those', () => {
    const ids = CAMERA_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isCameraField)).toBe(true);
    expect(isCameraField('make')).toBe(false);
  });
});
