/**
 * Telemetry field formatting — pure, DOM-free, the single source of truth for
 * how a field's value reads on the overlay. Mirrors the units used in the
 * telemetry panels (`telemetry-view.tsx`) but as plain string functions, so it
 * is unit-testable and usable directly inside the canvas renderer.
 */

import type { Cue } from '../telemetry/srt-parser';
import {
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
  type SpeedUnit,
} from '../telemetry/motion';
import type { OverlayElement, TelemetryFieldKey } from './overlay-types';

export interface FieldSpec {
  /** Human label for the inspector / add menu. */
  label: string;
  /** Prepended to the raw value (e.g. `f/`). */
  prefix?: string;
  /** Appended to the raw value (e.g. ` m`). */
  suffix?: string;
}

export const FIELD_SPECS: Record<TelemetryFieldKey, FieldSpec> = {
  rel_alt: { label: 'Rel. altitude', suffix: ' m' },
  abs_alt: { label: 'Abs. altitude', suffix: ' m' },
  // Derived motion fields carry their own units (and sign / compass), so they
  // are formatted by `motion.ts`, not by the prefix/suffix below.
  gnd_speed: { label: 'Ground speed' },
  vert_speed: { label: 'Vertical speed' },
  heading: { label: 'Heading' },
  latitude: { label: 'Latitude' },
  longitude: { label: 'Longitude' },
  iso: { label: 'ISO' },
  shutter: { label: 'Shutter' },
  fnum: { label: 'Aperture', prefix: 'f/' },
  ev: { label: 'EV' },
  focal_len: { label: 'Focal length', suffix: ' mm' },
  color_md: { label: 'Color profile' },
  ct: { label: 'Color temp.', suffix: ' K' },
  frame: { label: 'Frame' },
  timestamp: { label: 'Timestamp' },
};

/** All field keys in menu order. */
export const FIELD_KEYS = Object.keys(FIELD_SPECS) as TelemetryFieldKey[];

/** Placeholder rendered when a value is missing. */
export const MISSING = '—';

/**
 * Resolve a field's display string for `cue`, including unit prefix/suffix.
 * Returns {@link MISSING} when the cue or the value is absent.
 *
 * @param speedUnit Only used for `gnd_speed` / `vert_speed` — defaults to `'m/s'`.
 */
export function formatField(
  key: TelemetryFieldKey,
  cue: Cue | null,
  speedUnit?: SpeedUnit,
): string {
  if (!cue) return MISSING;
  switch (key) {
    case 'frame':
      return cue.frame != null ? String(cue.frame) : MISSING;
    case 'timestamp':
      return cue.timestamp ?? MISSING;
    case 'gnd_speed':
      return formatGroundSpeed(cue.derived?.groundSpeed, speedUnit) ?? MISSING;
    case 'vert_speed':
      return formatVerticalSpeed(cue.derived?.verticalSpeed, speedUnit) ?? MISSING;
    case 'heading':
      return formatHeading(cue.derived?.heading) ?? MISSING;
  }

  const raw = cue.data[key];
  if (raw === undefined || raw === '') return MISSING;

  const spec = FIELD_SPECS[key];
  return `${spec.prefix ?? ''}${raw}${spec.suffix ?? ''}`;
}

/**
 * The full string an element renders for `cue`: a free-text element returns its
 * literal; a telemetry element returns `LABEL value` (or just the value when no
 * label is set). Heading-arrow elements return `''` (they render a shape, not text).
 */
export function renderElementText(el: OverlayElement, cue: Cue | null): string {
  if (el.kind === 'text') return el.text ?? '';
  if (el.kind === 'heading-arrow' || !el.field) return '';
  const value = formatField(el.field, cue, el.speedUnit);
  const label = el.label?.trim();
  return label ? `${label} ${value}` : value;
}
