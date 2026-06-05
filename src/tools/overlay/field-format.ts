/**
 * Telemetry field formatting — pure, DOM-free, the single source of truth for
 * how a field's value reads on the overlay. Mirrors the units used in the
 * telemetry panels (`telemetry-view.tsx`) but as plain string functions, so it
 * is unit-testable and usable directly inside the canvas renderer.
 */

import type { Cue } from '../telemetry/srt-parser';
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
 */
export function formatField(key: TelemetryFieldKey, cue: Cue | null): string {
  if (!cue) return MISSING;
  if (key === 'frame') return cue.frame != null ? String(cue.frame) : MISSING;
  if (key === 'timestamp') return cue.timestamp ?? MISSING;

  const raw = cue.data[key];
  if (raw === undefined || raw === '') return MISSING;

  const spec = FIELD_SPECS[key];
  return `${spec.prefix ?? ''}${raw}${spec.suffix ?? ''}`;
}

/**
 * The full string an element renders for `cue`: a free-text element returns its
 * literal; a telemetry element returns `LABEL value` (or just the value when no
 * label is set).
 */
export function renderElementText(el: OverlayElement, cue: Cue | null): string {
  if (el.kind === 'text') return el.text ?? '';
  if (!el.field) return '';
  const value = formatField(el.field, cue);
  const label = el.label?.trim();
  return label ? `${label} ${value}` : value;
}
