/**
 * Clipping — what has gone to white or to black, pixel by pixel (audit item
 * 15, `docs/lightroom-gaps.md`): the rule the histogram's clip marks count by,
 * the colours the stage paints it in, and how a readout tells a painted pixel
 * from a photographed one.
 *
 * ONE rule for the three readers — the strip's percentages
 * (`develop/histogram.ts`), the overlay on the picture (`clip-pass.ts`, a
 * transcription of `clipOf`) and the readout under the pointer — so a pixel
 * the strip counts is a pixel the picture marks.
 *
 * Pure and DOM-free.
 */

/** An 8-bit value at or past which a channel has lost its highlight detail. */
export const CLIP_WHITE = 254;
/** An 8-bit value at or under which a channel has lost its shadow detail. */
export const CLIP_BLACK = 1;

export type Clip = 'white' | 'black';

/**
 * Whether an 8-bit pixel is clipped: to WHITE when ANY channel is — a sky
 * whose red alone has gone has lost its colour, and that is what a
 * photographer means by blown — and to BLACK only when EVERY channel is,
 * because a saturated blue with no red in it is a colour, not a crushed
 * shadow. White is asked first: a pixel cannot be both.
 */
export function clipOf(r: number, g: number, b: number): Clip | null {
  if (r >= CLIP_WHITE || g >= CLIP_WHITE || b >= CLIP_WHITE) return 'white';
  if (r <= CLIP_BLACK && g <= CLIP_BLACK && b <= CLIP_BLACK) return 'black';
  return null;
}

/**
 * The colours a clipped pixel is painted in on the stage — Lightroom's own
 * (red for highlights, blue for shadows), because a photographer reads them
 * without a legend.
 *
 * Each has ONE channel at 255, which is what lets `readoutOf` know it: a
 * photographed pixel within a step of either colour has that channel at 254
 * or more, so it is itself clipped to white and was painted over. No
 * unpainted pixel can wear a mark.
 */
export const CLIP_MARKS: Readonly<Record<Clip, readonly [number, number, number]>> = {
  white: [255, 0, 0],
  black: [0, 128, 255],
};

/** What the pointer is over, said one way for every reader. */
export type Readout =
  | { kind: 'value'; r: number; g: number; b: number }
  | { kind: 'clip'; clip: Clip };

/**
 * An 8-bit pixel read off the stage, as the author should be told it. With
 * the clipping view on, a pixel wearing a mark is read as the clip it marks
 * rather than as the mark's own numbers — `0 128 255` over a crushed shadow
 * would be a fabricated value. A step of tolerance, because a scaled draw
 * can round a mark's inner pixel by one.
 */
export function readoutOf(r: number, g: number, b: number, clipping: boolean): Readout {
  if (clipping) {
    for (const clip of ['white', 'black'] as const) {
      const [mr, mg, mb] = CLIP_MARKS[clip];
      if (Math.abs(r - mr) <= 1 && Math.abs(g - mg) <= 1 && Math.abs(b - mb) <= 1) return { kind: 'clip', clip };
    }
  }
  return { kind: 'value', r, g, b };
}

/** "R 212 · G 180 · B 96", or what the mark means. */
export function readoutLabel(readout: Readout): string {
  if (readout.kind === 'clip') return readout.clip === 'white' ? 'clipped to white' : 'crushed to black';
  const n = (v: number) => String(Math.round(v)).padStart(3, ' ');
  return `R ${n(readout.r)} · G ${n(readout.g)} · B ${n(readout.b)}`;
}
