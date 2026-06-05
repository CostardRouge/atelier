import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSrt } from '../telemetry/srt-parser';
import { formatField, renderElementText, MISSING } from './field-format';
import { createTelemetryElement, createTextElement } from './overlay-types';

const fixture = readFileSync(
  fileURLToPath(new URL('../../../tests/fixtures/sample.srt', import.meta.url)),
  'utf-8',
);
const cues = parseSrt(fixture);
const cue = cues[0];

describe('formatField', () => {
  it('appends metric units for altitude', () => {
    expect(formatField('rel_alt', cue)).toBe('35.200 m');
    expect(formatField('abs_alt', cue)).toBe('80.196 m');
  });

  it('prefixes aperture with f/', () => {
    expect(formatField('fnum', cue)).toBe('f/1.7');
  });

  it('suffixes colour temperature and focal length', () => {
    expect(formatField('ct', cue)).toBe('5300 K');
    expect(formatField('focal_len', cue)).toBe('24.00 mm');
  });

  it('passes raw values through untouched', () => {
    expect(formatField('iso', cue)).toBe('100');
    expect(formatField('shutter', cue)).toBe('1/500.0');
  });

  it('reads frame and timestamp off the cue, not its data', () => {
    expect(formatField('frame', cue)).toBe('1');
    expect(formatField('timestamp', cue)).toBe('2026-05-30 05:49:34.609');
  });

  it('returns the placeholder when the cue or value is missing', () => {
    expect(formatField('rel_alt', null)).toBe(MISSING);
    expect(formatField('iso', { ...cue, data: {} })).toBe(MISSING);
    expect(formatField('frame', { ...cue, frame: null })).toBe(MISSING);
  });
});

describe('renderElementText', () => {
  it('composes a label prefix with the value', () => {
    const el = createTelemetryElement('rel_alt'); // default label "ALT"
    expect(renderElementText(el, cue)).toBe('ALT 35.200 m');
  });

  it('omits the prefix when the label is cleared', () => {
    const el = { ...createTelemetryElement('iso'), label: '' };
    expect(renderElementText(el, cue)).toBe('100');
  });

  it('returns the literal for a text element', () => {
    const el = createTextElement('Sunset flight');
    expect(renderElementText(el, cue)).toBe('Sunset flight');
  });

  it('shows the placeholder for a missing telemetry value', () => {
    const el = { ...createTelemetryElement('iso'), label: '' };
    expect(renderElementText(el, null)).toBe(MISSING);
  });
});
