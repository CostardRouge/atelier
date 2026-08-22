/**
 * Editor-only composition guides for the Telemetry Overlay stage: social-media
 * safe zones (the areas a platform's UI chrome covers) and a configurable grid
 * for snapping.
 *
 * Pure and DOM-free. The stage draws these on the preview canvas ONLY — never
 * through `drawOverlays` — so they help you compose but never burn into the
 * exported MP4. Geometry helpers live here so they're unit-testable.
 */

/** A rectangle in normalized [0,1] coords, relative to a reference frame. */
export interface GuideRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Short label drawn in the zone, e.g. 'Caption'. */
  label?: string;
}

export interface SafeZonePreset {
  id: string;
  label: string;
  /** Target aspect ratio (width / height). Most social verticals are 9/16. */
  aspect: number;
  /** Areas the platform chrome covers, normalized to the target frame. */
  deadzones: GuideRect[];
}

// Approximate, hand-measured from current app layouts (2025). Platform UIs
// shift over time and by device; treat these as guides, not pixel-exact masks.
export const SAFE_ZONE_PRESETS: readonly SafeZonePreset[] = [
  {
    id: 'tiktok',
    label: 'TikTok',
    aspect: 9 / 16,
    deadzones: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.07, label: 'Top' },
      { x: 0.84, y: 0.42, w: 0.16, h: 0.46, label: 'Actions' },
      { x: 0.0, y: 0.8, w: 0.84, h: 0.2, label: 'Caption' },
    ],
  },
  {
    id: 'reels',
    label: 'Instagram Reels',
    aspect: 9 / 16,
    deadzones: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.08, label: 'Top' },
      { x: 0.84, y: 0.38, w: 0.16, h: 0.44, label: 'Actions' },
      { x: 0.0, y: 0.78, w: 0.84, h: 0.22, label: 'Caption' },
    ],
  },
  {
    id: 'shorts',
    label: 'YouTube Shorts',
    aspect: 9 / 16,
    deadzones: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.06, label: 'Top' },
      { x: 0.84, y: 0.44, w: 0.16, h: 0.42, label: 'Actions' },
      { x: 0.0, y: 0.82, w: 0.84, h: 0.18, label: 'Title' },
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    aspect: 16 / 9,
    deadzones: [{ x: 0.0, y: 0.88, w: 1.0, h: 0.12, label: 'Controls' }],
  },
];

/** The active safe-zone preset, or null for `'none'` / unknown ids. */
export function findSafeZone(id: string): SafeZonePreset | null {
  return SAFE_ZONE_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * How the safe-zone template is laid over the frame.
 *
 * Each preset is authored for one orientation (portrait for Reels, TikTok and
 * Shorts; landscape for YouTube), so over a frame of the opposite orientation
 * the upright template shrinks to a band across the middle — true for the crop
 * it describes, useless for reading a landscape composition. `'rotated'` turns
 * the template a quarter-turn so it spans the frame instead; `'auto'` (the
 * default) does that only when the two orientations disagree, and `'upright'`
 * pins the template as authored.
 */
export type SafeZoneOrientation = 'auto' | 'upright' | 'rotated';

/**
 * -1 portrait, 1 landscape, 0 square-ish. The dead band around 1:1 keeps
 * near-square frames and templates out of the rotation logic, where a
 * quarter-turn moves nothing anyone could see.
 */
export function orientationOf(aspect: number): -1 | 0 | 1 {
  if (!Number.isFinite(aspect) || aspect <= 0) return 0;
  if (aspect > 1.02) return 1;
  if (aspect < 0.98) return -1;
  return 0;
}

/** Whether `mode` calls for a quarter-turn over a frame of `frameAspect`. */
export function shouldRotateSafeZone(
  mode: SafeZoneOrientation,
  presetAspect: number,
  frameAspect: number,
): boolean {
  if (mode === 'rotated') return true;
  if (mode === 'upright') return false;
  const p = orientationOf(presetAspect);
  const f = orientationOf(frameAspect);
  return p !== 0 && f !== 0 && p !== f;
}

/**
 * The preset turned a quarter-turn **clockwise** — the phone tipped onto its
 * right-hand side. The aspect inverts and every deadzone travels with it: the
 * portrait top bar becomes a strip down the right edge, the right-hand action
 * column becomes a band along the bottom.
 *
 * The labels are deliberately NOT rotated by this (nor by the drawing code):
 * they name what covers the area and have to stay readable.
 */
export function rotateSafeZone(preset: SafeZonePreset): SafeZonePreset {
  return {
    ...preset,
    aspect: 1 / preset.aspect,
    deadzones: preset.deadzones.map((r) => ({
      ...r,
      x: 1 - r.y - r.h,
      y: r.x,
      w: r.h,
      h: r.w,
    })),
  };
}

/**
 * The safe-zone template to draw over a `frameAspect` frame, already turned
 * when the state (or the frame) calls for it. Null when no preset is picked.
 */
export function resolveSafeZone(
  guides: GuidesState,
  frameAspect: number,
): SafeZonePreset | null {
  const preset = findSafeZone(guides.safeZone);
  if (!preset) return null;
  const mode = guides.safeZoneOrientation ?? 'auto';
  return shouldRotateSafeZone(mode, preset.aspect, frameAspect)
    ? rotateSafeZone(preset)
    : preset;
}

export interface GridConfig {
  /** Draw the grid lines on the preview. */
  show: boolean;
  cols: number;
  rows: number;
  /** Snap a dragged element's anchor to the grid lines. */
  snap: boolean;
}

export interface GuidesState {
  /** Active safe-zone preset id, or 'none'. */
  safeZone: string;
  /** Quarter-turn handling for that preset; see {@link SafeZoneOrientation}. */
  safeZoneOrientation: SafeZoneOrientation;
  grid: GridConfig;
}

export const DEFAULT_GUIDES: GuidesState = {
  safeZone: 'none',
  safeZoneOrientation: 'auto',
  grid: { show: false, cols: 3, rows: 3, snap: false },
};

/** Clamp a grid division count to a sane, integer range. */
export function clampDivisions(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(12, Math.round(n)));
}

/**
 * Snap a normalized coordinate to the nearest of `divisions` grid lines (a
 * 3-division axis has lines at 0, 1/3, 2/3, 1) when within `tol`. Returns the
 * input unchanged when no line is close enough or `divisions` < 1.
 */
export function snapToGrid(value: number, divisions: number, tol = 0.025): number {
  if (divisions < 1) return value;
  const line = Math.round(value * divisions) / divisions;
  return Math.abs(value - line) <= tol ? line : value;
}

/**
 * The largest rectangle of `aspect` (w/h) centered inside a `vw`×`vh` frame —
 * the centered crop the target platform would show. Returns pixel coords.
 */
export function targetFrame(
  aspect: number,
  vw: number,
  vh: number,
): { x: number; y: number; w: number; h: number } {
  const frameAspect = vw / vh;
  let w: number;
  let h: number;
  if (aspect < frameAspect) {
    // Target is narrower than the frame → full height, pillarboxed.
    h = vh;
    w = vh * aspect;
  } else {
    // Target is wider (or equal) → full width, letterboxed.
    w = vw;
    h = vw / aspect;
  }
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}
