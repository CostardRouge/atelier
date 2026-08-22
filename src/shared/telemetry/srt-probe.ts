/**
 * Reading a clip's cadence without reading its telemetry — the library's route
 * to the fps badge.
 *
 * The sidebar lists whole folders, so nothing there may cost a file-sized read:
 * `probeContainer` walks up to 48 MB of mp4 looking for a `moov`, which is fine
 * for the one clip being edited and ruinous for two hundred rows scrolling past.
 * The `.srt` beside the clip answers the same question for a few kilobytes,
 * because cadence lives in its *timings*, not in its payload: the spacing
 * between cues is the rate the file plays at, and the capture timestamps say how
 * much real time that spacing covers.
 *
 * So this reads the **head and the tail** and nothing in between. The head gives
 * the frame spacing (dense, consecutive cues); the two ends together give the
 * longest possible baseline for the conform ratio, which is what makes the
 * measurement precise. `measureTimeScale` is built for exactly this shape — a
 * hole in the middle costs precision, never correctness.
 */

import { parseSrt } from './srt-parser';
import { measureTimeScale, REALTIME, type TimeScaleReading } from './time-scale';

/** Bytes read from each end — roughly 500 cues of a DJI log per slice. */
const SLICE_BYTES = 128 * 1024;

async function textOf(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  // A byte slice can cut a UTF-8 sequence in half; replacement characters are
  // harmless here, the parser only reads ASCII digits and keywords.
  return new TextDecoder('utf-8').decode(buffer);
}

/**
 * Measure a clip's cadence from its `.srt`, reading only both ends of the file.
 *
 * Returns {@link REALTIME} (`basis: 'none'`) when the file is unreadable, is not
 * the bracket format, or carries no usable timing — the caller then shows
 * nothing rather than a cadence nobody measured.
 */
export async function probeSrtTiming(file: Blob): Promise<TimeScaleReading> {
  try {
    if (file.size <= SLICE_BYTES * 2) {
      return measureTimeScale(parseSrt(await textOf(file), { timeScale: 1 }));
    }
    const [head, tail] = await Promise.all([
      textOf(file.slice(0, SLICE_BYTES)),
      textOf(file.slice(file.size - SLICE_BYTES)),
    ]);
    const headCues = parseSrt(head, { timeScale: 1 });
    // The tail starts mid-block: its first cue may have lost half its payload.
    const tailCues = parseSrt(tail, { timeScale: 1 }).slice(1);
    if (headCues.length === 0) return REALTIME;
    const last = headCues[headCues.length - 1].start;
    return measureTimeScale([
      ...headCues,
      ...tailCues.filter((c) => c.start > last),
    ]);
  } catch {
    // A folder-picked handle can go stale between the pick and the scroll that
    // reads it; an unreadable sidecar is "unknown", not an error to surface.
    return REALTIME;
  }
}
