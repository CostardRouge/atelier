/**
 * Pure, dependency-free, DOM-free parser for DJI telemetry SRT files.
 *
 * DJI drones write a `.srt` next to each `.mp4`. Despite the SubRip extension
 * it is not subtitle text but per-frame flight telemetry. This module turns
 * that text into a sorted list of {@link Cue}s.
 *
 * Designed to be imported as-is into any context (browser, Node, worker,
 * Next.js): it has no external dependencies and never touches the DOM.
 */

import { attachMotion, type Motion } from './motion';
import { measureTimeScale } from './time-scale';

export interface TelemetryData {
  iso?: string;
  shutter?: string;
  fnum?: string;
  ev?: string;
  color_md?: string;
  focal_len?: string;
  latitude?: string;
  longitude?: string;
  rel_alt?: string;
  abs_alt?: string;
  ct?: string;
  /** Tolerant to extra/unknown fields emitted by other firmware versions. */
  [key: string]: string | undefined;
}

export interface Cue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** DJI FrameCnt, or null if absent. */
  frame: number | null;
  /** Capture timestamp line as written, or null if absent. */
  timestamp: string | null;
  /**
   * DJI's `DiffTime`, in **seconds** — the real interval between this telemetry
   * sample and the previous one, which is not the interval the file plays them
   * at on conformed (slow-motion, time-lapse) footage. Absent when the firmware
   * does not write it. See telemetry/time-scale.ts.
   */
  diffTime?: number;
  data: TelemetryData;
  /**
   * Motion (ground/vertical speed, heading) reconstructed from the GPS and
   * altitude of surrounding cues. Attached by {@link parseSrt}; absent only on
   * cues parsed outside that path. See {@link attachMotion}.
   */
  derived?: Motion;
  /**
   * The same motion measured **forward** instead of backward, attached only to
   * the cues of the clip's opening window — where there is no past to measure
   * against and the instruments would otherwise read `—`. Never overwrites
   * {@link derived}; consumers merge the two through `motionAt`. See
   * {@link attachMotion}.
   */
  lead?: Motion;
}

/**
 * Known SRT telemetry formats. Today only the modern "bracket" format is
 * implemented, but detection is kept explicit so other formats (older Mavic
 * `GPS(...)` / `BAROMETER:` style, etc.) can be added without rewriting the
 * entry point.
 */
type SrtFormat = 'bracket' | 'unknown';

/** Matches `HH:MM:SS,mmm --> HH:MM:SS,mmm` timing lines. */
const TIMING_RE =
  /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

/** Captures every `[ ... ]` group's inner content. */
const BRACKET_RE = /\[([^\]]*)\]/g;

/**
 * Captures `key: value` pairs. Values run until the next `key:` token or end
 * of string, so a single bracket holding two pairs
 * (e.g. `[rel_alt: 35.200 abs_alt: 80.196]`) is split correctly.
 */
const KV_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^[\]]*?)(?=\s+[A-Za-z_][A-Za-z0-9_]*\s*:|$)/g;

const FRAME_RE = /FrameCnt\s*:\s*(\d+)/;

/**
 * `DiffTime: 16ms` — sits on the FrameCnt line, outside the `[ ]` groups, so the
 * bracket sweep never sees it. Kept because it is the only per-cue statement of
 * the *capture* cadence (telemetry/time-scale.ts).
 */
const DIFF_TIME_RE = /DiffTime\s*:\s*([\d.]+)\s*ms/i;

/** ISO-like capture timestamp, e.g. `2026-05-30 05:49:34.609`. */
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/;

function timecodeToSeconds(
  h: string,
  m: string,
  s: string,
  ms: string,
): number {
  return (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
  );
}

/** Strip HTML-ish tags such as the wrapping `<font ...>...</font>`. */
function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

function detectFormat(text: string): SrtFormat {
  // The modern format wraps fields in `[ ... ]` brackets.
  if (BRACKET_RE.test(text)) {
    BRACKET_RE.lastIndex = 0;
    return 'bracket';
  }
  BRACKET_RE.lastIndex = 0;
  return 'unknown';
}

/**
 * Parse the telemetry payload of a single cue (everything after the timing
 * line) for the bracket format.
 */
function parseBracketPayload(payload: string): {
  frame: number | null;
  timestamp: string | null;
  diffTime: number | undefined;
  data: TelemetryData;
} {
  const clean = stripTags(payload);

  const frameMatch = clean.match(FRAME_RE);
  const frame = frameMatch ? Number(frameMatch[1]) : null;

  const diffMatch = clean.match(DIFF_TIME_RE);
  const diffMs = diffMatch ? Number(diffMatch[1]) : NaN;
  const diffTime = Number.isFinite(diffMs) && diffMs > 0 ? diffMs / 1000 : undefined;

  const timestampMatch = clean.match(TIMESTAMP_RE);
  const timestamp = timestampMatch ? timestampMatch[0] : null;

  // Validated approach for the double-pair bracket pitfall: gather the inner
  // content of every bracket, join it, then sweep with a global `key: value`
  // regex. This handles both `[k: v]` and `[k1: v1 k2: v2]` with no special
  // casing.
  const brackets: string[] = [];
  let m: RegExpExecArray | null;
  BRACKET_RE.lastIndex = 0;
  while ((m = BRACKET_RE.exec(clean)) !== null) {
    brackets.push(m[1]);
  }
  const joined = brackets.join(' ');

  const data: TelemetryData = {};
  KV_RE.lastIndex = 0;
  while ((m = KV_RE.exec(joined)) !== null) {
    const key = m[1];
    const value = m[2].trim();
    if (value.length > 0) {
      data[key] = value;
    }
  }

  return { frame, timestamp, diffTime, data };
}

export interface ParseSrtOptions {
  /**
   * Capture seconds per second of media, for footage the camera conformed
   * (slow motion, time-lapse). `'auto'` — the default — measures it from the
   * cues themselves so every consumer of `cue.derived` gets true speeds without
   * knowing the concept exists; a number forces it, and `1` leaves the rates in
   * media time. See telemetry/time-scale.ts.
   */
  timeScale?: number | 'auto';
}

/**
 * Parse a DJI telemetry SRT file into a list of cues, sorted by ascending
 * start time.
 *
 * @param text Raw contents of the `.srt` file.
 * @param options See {@link ParseSrtOptions}.
 * @returns Cues in start-time order. Malformed blocks are skipped.
 */
export function parseSrt(text: string, options: ParseSrtOptions = {}): Cue[] {
  const format = detectFormat(text);
  if (format !== 'bracket') {
    // Only the bracket format is supported today. Returning empty rather than
    // throwing keeps the caller simple; future formats plug in here.
    return [];
  }

  // Normalise line endings and split into blocks on blank lines.
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalised.split(/\n\s*\n/);

  const cues: Cue[] = [];

  for (const block of blocks) {
    const timing = block.match(TIMING_RE);
    if (!timing) {
      continue;
    }

    const start = timecodeToSeconds(timing[1], timing[2], timing[3], timing[4]);
    const end = timecodeToSeconds(timing[5], timing[6], timing[7], timing[8]);

    // Payload is everything after the timing line.
    const payload = block.slice(timing.index! + timing[0].length);

    const { frame, timestamp, diffTime, data } = parseBracketPayload(payload);

    cues.push({ start, end, frame, timestamp, diffTime, data });
  }

  cues.sort((a, b) => a.start - b.start);

  // Reconstruct per-frame motion (speed, heading) now the cues are in order, so
  // every consumer — panels, gallery, overlay — gets it for free. Rates are
  // derived against CAPTURE seconds: on a conformed clip the file's own seconds
  // would divide a real distance by a stretched time and under-report every
  // speed. Measuring by default means a slow-motion clip is right everywhere,
  // not only where someone remembered to ask.
  const requested = options.timeScale ?? 'auto';
  const timeScale = requested === 'auto' ? measureTimeScale(cues).scale : requested;
  attachMotion(cues, timeScale);

  return cues;
}
