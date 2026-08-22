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
    // The timestamp is re-formatted rather than echoed: milliseconds are noise
    // on a title card, so they are opt-in.
    expect(formatField('timestamp', cue)).toBe('2026-05-30 05:49:34');
    expect(
      formatField('timestamp', cue, undefined, { format: { milliseconds: true } }),
    ).toBe('2026-05-30 05:49:34.609');
  });

  it('formats the time fields, and corrects them by the project shift', () => {
    expect(formatField('clock', cue)).toBe('05:49:34');
    expect(formatField('date', cue)).toBe('2026-05-30');

    const opts = { format: { hour12: true, seconds: false }, shift: null };
    expect(formatField('clock', cue, undefined, opts)).toBe('5:49 AM');

    // A correction rolls the date when it crosses midnight — one shift, both
    // fields, so the clock and the date can never disagree.
    const shift = { minutes: -6 * 60, days: 0 };
    expect(formatField('clock', cue, undefined, { shift })).toBe('23:49:34');
    expect(formatField('date', cue, undefined, { shift })).toBe('2026-05-29');
  });

  it('says nothing when there is no timestamp to read', () => {
    const blind = { ...cue, timestamp: null };
    expect(formatField('clock', blind)).toBe('—');
    expect(formatField('date', blind)).toBe('—');
    expect(formatField('timestamp', blind)).toBe('—');
  });

  it('formats the GPS-derived motion fields off cue.derived', () => {
    const moving = {
      ...cue,
      derived: { groundSpeed: 12.34, verticalSpeed: -1.2, heading: 270 },
    };
    expect(formatField('gnd_speed', moving)).toBe('12.3 m/s');
    expect(formatField('vert_speed', moving)).toBe('-1.2 m/s');
    expect(formatField('heading', moving)).toBe('270° W');
  });

  it('shows the placeholder when motion was not derivable', () => {
    // The fixture cues are 16 ms apart, so no motion is derived for them.
    expect(formatField('gnd_speed', cue)).toBe(MISSING);
    expect(formatField('heading', cue)).toBe(MISSING);
    expect(formatField('vert_speed', { ...cue, derived: {} })).toBe(MISSING);
  });

  it('fills a missing motion value from the opening window look-ahead', () => {
    const opening = { ...cue, derived: {}, lead: { groundSpeed: 12.34, heading: 270 } };
    expect(formatField('gnd_speed', opening)).toBe('12.3 m/s');
    expect(formatField('heading', opening)).toBe('270° W');
    // Opted out on the element, the readout waits for a backward measurement.
    expect(formatField('gnd_speed', opening, undefined, undefined, false)).toBe(MISSING);
    expect(formatField('heading', opening, undefined, undefined, false)).toBe(MISSING);
  });

  it('never lets the look-ahead cover a measured value', () => {
    const both = { ...cue, derived: { groundSpeed: 3 }, lead: { groundSpeed: 12.34 } };
    expect(formatField('gnd_speed', both)).toBe('3.0 m/s');
  });

  it('returns the placeholder when the cue or value is missing', () => {
    expect(formatField('rel_alt', null)).toBe(MISSING);
    expect(formatField('iso', { ...cue, data: {} })).toBe(MISSING);
    expect(formatField('frame', { ...cue, frame: null })).toBe(MISSING);
  });
});

/** `1.5` → `00:00:01,500`, the SRT timing shape. */
function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(
    Math.floor(ms / 1000) % 60,
  )},${pad(ms % 1000, 3)}`;
}

/** A 2-second, 30 fps clip flying due north at ~10 m/s. */
function northboundClip(): string {
  const step = 1 / 30;
  return Array.from({ length: 60 }, (_, i) => {
    const t = i * step;
    const lat = (16 + t * 8.98e-5).toFixed(6); // ~10 m/s
    return [
      String(i + 1),
      `${srtTime(t)} --> ${srtTime(t + step)}`,
      `<font size="28">FrameCnt: ${i + 1}, DiffTime: 33ms`,
      '2026-05-30 05:49:34.609',
      `[iso: 100] [latitude: ${lat}] [longitude: -61.000000] [rel_alt: ${(35 + t).toFixed(3)} abs_alt: 80.196] </font>`,
    ].join('\n');
  }).join('\n\n');
}

describe('the first frame of a clip', () => {
  it('reads its instruments instead of showing dashes', () => {
    const clip = parseSrt(northboundClip());
    const first = clip[0];

    // What the look-back alone can say about frame 1: nothing.
    expect(formatField('gnd_speed', first, undefined, undefined, false)).toBe(MISSING);
    expect(formatField('heading', first, undefined, undefined, false)).toBe(MISSING);

    // What the clip is actually doing there, measured over the second ahead.
    expect(formatField('gnd_speed', first)).toBe('10.0 m/s');
    expect(formatField('heading', first)).toBe('0° N');
    expect(formatField('vert_speed', first)).toBe('+1.0 m/s');
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

  it('anticipates the opening window unless the element opts out', () => {
    const opening = { ...cue, derived: {}, lead: { groundSpeed: 12.34 } };
    const el = { ...createTelemetryElement('gnd_speed'), label: '' };
    expect(renderElementText(el, opening)).toBe('12.3 m/s');
    expect(renderElementText({ ...el, earlyValues: false }, opening)).toBe(MISSING);
  });
});
