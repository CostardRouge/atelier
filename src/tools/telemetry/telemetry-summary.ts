/**
 * Pure summary of a parsed telemetry track. No DOM, no React. Derived entirely
 * from the v1 parser's `Cue[]` output.
 */

import type { Cue } from './srt-parser';

export interface TelemetrySummary {
  /** Number of cues (≈ frames of telemetry). */
  cueCount: number;
  /** Min/max relative altitude in metres, or null if no rel_alt present. */
  relAltMin: number | null;
  relAltMax: number | null;
  /** Coordinates of the first cue that has them, as raw strings. */
  startLatitude: string | null;
  startLongitude: string | null;
  /** Color profile (color_md) of the first cue that has one. */
  colorProfile: string | null;
}

/** Parse a numeric field defensively; returns null on missing/NaN. */
function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute a lightweight summary from parsed cues. Returns a zeroed summary for
 * an empty track rather than throwing.
 */
export function summarizeTelemetry(cues: Cue[]): TelemetrySummary {
  let relAltMin: number | null = null;
  let relAltMax: number | null = null;
  let startLatitude: string | null = null;
  let startLongitude: string | null = null;
  let colorProfile: string | null = null;

  for (const cue of cues) {
    const rel = num(cue.data.rel_alt);
    if (rel !== null) {
      relAltMin = relAltMin === null ? rel : Math.min(relAltMin, rel);
      relAltMax = relAltMax === null ? rel : Math.max(relAltMax, rel);
    }

    if (startLatitude === null && cue.data.latitude !== undefined) {
      startLatitude = cue.data.latitude;
    }
    if (startLongitude === null && cue.data.longitude !== undefined) {
      startLongitude = cue.data.longitude;
    }
    if (colorProfile === null && cue.data.color_md !== undefined) {
      colorProfile = cue.data.color_md;
    }
  }

  return {
    cueCount: cues.length,
    relAltMin,
    relAltMax,
    startLatitude,
    startLongitude,
    colorProfile,
  };
}
