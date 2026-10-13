/**
 * A flight read from its `.srt`, small enough to DRAW in a list — the shape
 * the Winnow picker's Logbook puts where a thumbnail would be, and the three
 * numbers beside it. Pure and DOM-free.
 *
 * The shape is the track projected flat around its first fix (metres east
 * and south, an equirectangular projection: a drone flight is a few km, where
 * the error is nothing a 90-pixel glyph can show), thinned to a handful of
 * points evenly spread along the list. The numbers are `flightSummary`'s, so
 * the picker and the agent's `winnow.flights` say the same thing.
 */

import { extractTrack } from '../../../telemetry/flight-path';
import { flightSummary } from '../../../telemetry/flight-summary';
import { parseSrt } from '../../../telemetry/srt-parser';

export interface FlightTrack {
  /** Seconds of telemetry. */
  seconds: number;
  km: number | null;
  maxHeightM: number | null;
  /** `[x0, y0, x1, y1, …]` in metres from the take-off, east and SOUTH (screen y). */
  points: number[];
}

/** The flight in `text`, or null when the log holds no located fix. */
export function flightTrackFromSrt(text: string, maxPoints = 96): FlightTrack | null {
  const cues = parseSrt(text);
  const track = extractTrack(cues);
  if (track.length === 0) return null;
  const summary = flightSummary(cues);
  const lat0 = track[0].lat;
  const lon0 = track[0].lon;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const step = Math.max(1, Math.ceil(track.length / Math.max(2, maxPoints)));
  const points: number[] = [];
  for (let i = 0; i < track.length; i += step) {
    points.push((track[i].lon - lon0) * kx, (lat0 - track[i].lat) * ky);
  }
  const last = track[track.length - 1];
  if ((track.length - 1) % step !== 0) points.push((last.lon - lon0) * kx, (lat0 - last.lat) * ky);
  return { seconds: summary.seconds, km: summary.km, maxHeightM: summary.maxHeightM, points };
}

/** The box a track's points span, `[x0, y0, x1, y1]`. */
export function trackBox(points: readonly number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    x0 = Math.min(x0, points[i]);
    x1 = Math.max(x1, points[i]);
    y0 = Math.min(y0, points[i + 1]);
    y1 = Math.max(y1, points[i + 1]);
  }
  return [x0, y0, x1, y1];
}
