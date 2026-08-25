/**
 * The frame plan for an export TAIL — content appended after the footage's
 * last frame, today the Studio's outro card. Pure and DOM-free; the encoding
 * itself happens in `webcodecs-export.ts` and `export-overlay-seek.ts`.
 *
 * Appending is deliberately the whole feature: nothing already encoded moves,
 * the audio is still copied bit-for-bit and simply ends with the footage (the
 * card plays silent, which is what an outro is on every platform), and the
 * trim arithmetic never learns the output grew. That is what makes "output
 * longer than the source" cheap at this end of the file, where a pre-roll —
 * which shifts every timestamp — is not.
 */

/** What the pipelines need to append: a duration, and a painter for it. */
export interface ExportTail {
  /** Seconds of card after the footage. Nothing is appended for <= 0. */
  seconds: number;
  /**
   * Produce the frame at `tSeconds` into the tail's own life, at the export's
   * output size. Called once per appended frame, so a static card is cheap
   * and an animated one plays.
   */
  draw: (tSeconds: number) => CanvasImageSource;
}

export interface TailFrame {
  /** Seconds into the tail's own life — what `draw` receives. */
  tSeconds: number;
  /** Encoder timestamp in microseconds, continuing the footage's timeline. */
  timestampMicros: number;
  durationMicros: number;
}

/**
 * The appended frames: `seconds` of card at `fps`, starting exactly where the
 * footage ended. `endMicros` is the end of the last encoded frame (timestamp
 * plus duration) — passing the last timestamp alone would overlap the final
 * frame of the picture with the first frame of the card.
 */
export function tailFrames(
  seconds: number,
  fps: number,
  endMicros: number,
): TailFrame[] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  if (!Number.isFinite(fps) || fps <= 0) return [];
  const count = Math.max(1, Math.round(seconds * fps));
  const frames: TailFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    // Rounded per frame against the true rate, so NTSC-ish rates do not
    // accumulate drift over a long card.
    const start = Math.round((i * 1_000_000) / fps);
    const end = Math.round(((i + 1) * 1_000_000) / fps);
    frames.push({
      tSeconds: i / fps,
      timestampMicros: endMicros + start,
      durationMicros: end - start,
    });
  }
  return frames;
}
