/**
 * Pure helpers to turn parsed DJI telemetry into a flight path — no DOM, no
 * map library. Extracts the GPS track from the cues the SRT parser already
 * produced, so the same data that drives the Telemetry panels draws the map.
 */

import type { Cue } from './srt-parser';

export interface TrackPoint {
  lon: number;
  lat: number;
  /** Cue start time in seconds — lets the path line up with video playback. */
  t: number;
  /** Relative altitude in metres, when present. */
  alt: number | null;
}

export interface Bounds {
  /** [lon, lat] */
  min: [number, number];
  max: [number, number];
}

/**
 * Parse a cue's GPS to `[lon, lat]`, or `null` when it's missing or a
 * null-island `(0, 0)` fix (DJI writes that before the aircraft has a lock).
 */
export function parsePosition(cue: Cue): [number, number] | null {
  const lat = Number(cue.data.latitude);
  const lon = Number(cue.data.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

/** Extract the ordered list of located points from a clip's cues. */
export function extractTrack(cues: readonly Cue[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const cue of cues) {
    const pos = parsePosition(cue);
    if (!pos) continue;
    const alt = Number(cue.data.rel_alt);
    out.push({
      lon: pos[0],
      lat: pos[1],
      t: cue.start,
      alt: Number.isFinite(alt) ? alt : null,
    });
  }
  return out;
}

/** Bounding box of a track, or `null` when it has no points. */
export function trackBounds(track: readonly TrackPoint[]): Bounds | null {
  if (track.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of track) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { min: [minLon, minLat], max: [maxLon, maxLat] };
}

/** GeoJSON LineString coordinates (`[lon, lat][]`) for the path. */
export function lineCoordinates(track: readonly TrackPoint[]): [number, number][] {
  return track.map((p) => [p.lon, p.lat]);
}
