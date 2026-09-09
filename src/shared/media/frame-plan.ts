/**
 * The frames of a stretch of video we PAINT ourselves: how many there are,
 * when each starts on the encoder's timeline, and how long it lasts.
 *
 * Two callers, and they are one problem seen twice: the Studio's outro card
 * appended after the footage (`export-tail.ts`), and a whole clip painted from
 * nothing — a badge over a photograph, a deck played in order
 * (`render-video.ts`). Both need "N seconds at F fps starting here", and a
 * second copy of that arithmetic is how two exports come to disagree about a
 * duration.
 *
 * Pure and DOM-free.
 */

export interface PlannedFrame {
  /** Seconds into the painted stretch's own life — what a painter receives. */
  tSeconds: number;
  /** Encoder timestamp in microseconds, including the start offset. */
  timestampMicros: number;
  durationMicros: number;
}

/**
 * `seconds` of picture at `fps`, starting at `startMicros`.
 *
 * For an appended tail, `startMicros` is the end of the last encoded frame
 * (its timestamp PLUS its duration) — passing the last timestamp alone would
 * overlap the final frame of the footage with the first frame of the card.
 * For a clip painted from nothing it is 0.
 *
 * Nothing is planned for a non-finite or non-positive duration or rate: the
 * caller decides whether that is an error or simply nothing to append.
 */
export function framePlan(
  seconds: number,
  fps: number,
  startMicros = 0,
): PlannedFrame[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  if (!Number.isFinite(fps) || fps <= 0) return [];
  const count = Math.max(1, Math.round(seconds * fps));
  const frames: PlannedFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    // Rounded per frame against the true rate, so NTSC-ish rates do not
    // accumulate drift over a long card.
    const start = Math.round((i * 1_000_000) / fps);
    const end = Math.round(((i + 1) * 1_000_000) / fps);
    frames.push({
      tSeconds: i / fps,
      timestampMicros: startMicros + start,
      durationMicros: end - start,
    });
  }
  return frames;
}
