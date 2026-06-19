/**
 * Telemetry-overlay model for the Composer — pure, DOM-free. Decides which
 * readout lines to show (and how they read); the canvas drawing that consumes
 * this lives in the tool. Kept pure so the field/line logic and the colour
 * helper are unit-tested.
 */

import type { Cue } from '../telemetry/srt-parser';
import {
  formatGroundSpeed,
  formatHeading,
  formatVerticalSpeed,
} from '../telemetry/motion';

export type OverlayFont = 'mono' | 'sans' | 'serif';

export interface OverlayConfig {
  /** Master switch for the readout. */
  show: boolean;
  /** Which fields are active, keyed by field id. */
  fields: Record<string, boolean>;
  /** Prefix each value with its short label (ALT, SPD, …). */
  labels: boolean;
  textColor: string;
  bgColor: string;
  /** Background alpha, 0..1. */
  bgOpacity: number;
  /** Corner radius in output px. */
  radius: number;
  /** Multiplier on the auto font size. */
  fontScale: number;
  font: OverlayFont;
}

export interface OverlayField {
  id: string;
  label: string;
  get: (cue: Cue | null) => string | null;
}

export const OVERLAY_FIELDS: OverlayField[] = [
  { id: 'altitude', label: 'ALT', get: (c) => (c?.data.rel_alt ? `${c.data.rel_alt} m` : null) },
  { id: 'speed', label: 'SPD', get: (c) => formatGroundSpeed(c?.derived?.groundSpeed) ?? null },
  { id: 'vspeed', label: 'V/S', get: (c) => formatVerticalSpeed(c?.derived?.verticalSpeed) ?? null },
  { id: 'heading', label: 'HDG', get: (c) => formatHeading(c?.derived?.heading) ?? null },
  {
    id: 'coords',
    label: 'GPS',
    get: (c) =>
      c?.data.latitude && c?.data.longitude ? `${c.data.latitude}, ${c.data.longitude}` : null,
  },
  { id: 'absAlt', label: 'ABS', get: (c) => (c?.data.abs_alt ? `${c.data.abs_alt} m` : null) },
];

export const DEFAULT_OVERLAY: OverlayConfig = {
  show: true,
  fields: { altitude: true, speed: true, vspeed: false, heading: true, coords: true, absAlt: false },
  labels: true,
  textColor: '#ffffff',
  bgColor: '#0f0e0c',
  bgOpacity: 0.55,
  radius: 8,
  fontScale: 1,
  font: 'mono',
};

export const FONT_STACK: Record<OverlayFont, string> = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: 'system-ui, -apple-system, Segoe UI, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

/** The readout's lines for a cue, honouring active fields + the labels toggle. */
export function buildLines(cue: Cue | null, cfg: OverlayConfig): string[] {
  const out: string[] = [];
  for (const f of OVERLAY_FIELDS) {
    if (!cfg.fields[f.id]) continue;
    const v = f.get(cue);
    if (v == null) continue;
    out.push(cfg.labels ? `${f.label} ${v}` : v);
  }
  return out;
}

/** `#rrggbb` (or `#rgb`) + alpha → an `rgba(...)` string; black on a bad hex. */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
