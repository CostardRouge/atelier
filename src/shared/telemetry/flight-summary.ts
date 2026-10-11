/**
 * One FLIGHT as its `.srt` tells it — how long, how far, how high — read off
 * the parsed cues, for the agent's `winnow.flights` and a trip's facts.
 * Nothing is inferred past the log: a clip whose cues carry no position has
 * no distance, and a log with no altitude no height.
 *
 * Pure and DOM-free.
 */

import { extractTrack } from './flight-path';
import { haversine } from './motion';
import type { Cue } from './srt-parser';

export interface FlightSummary {
  /** Seconds of telemetry, from the first cue's start to the last cue's end. */
  seconds: number;
  /** Kilometres flown over the ground along the located cues, or null with fewer than two positions. */
  km: number | null;
  /** The highest height above take-off, in metres, or null when the log has none. */
  maxHeightM: number | null;
  /** Where the flight started, or null when no cue was located. */
  start: { lat: number; lon: number } | null;
}

export function flightSummary(cues: readonly Cue[]): FlightSummary {
  const seconds = cues.length ? Math.round((cues[cues.length - 1].end - cues[0].start) * 100) / 100 : 0;
  const track = extractTrack(cues);
  let metres = 0;
  for (let i = 1; i < track.length; i++) {
    metres += haversine(track[i - 1].lat, track[i - 1].lon, track[i].lat, track[i].lon);
  }
  const heights = track.map((p) => p.alt).filter((a): a is number => a !== null);
  return {
    seconds,
    km: track.length >= 2 ? Math.round(metres / 10) / 100 : null,
    maxHeightM: heights.length ? Math.round(Math.max(...heights) * 10) / 10 : null,
    start: track.length ? { lat: track[0].lat, lon: track[0].lon } : null,
  };
}
