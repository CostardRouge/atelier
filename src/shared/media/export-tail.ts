/**
 * Content appended AFTER the footage's last frame — today the Studio's outro
 * card. Pure and DOM-free; the encoding itself happens in
 * `webcodecs-export.ts` and `export-overlay-seek.ts`, and the frames it plans
 * come from `frame-plan.ts`, which a clip painted from nothing shares.
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
