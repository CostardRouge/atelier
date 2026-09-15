/**
 * The develop's one instrument: a luminance histogram of the picture as it
 * will be delivered, with how much of it is clipped at either end.
 *
 * One strip, not the retired Scopes tool (no waveform, no vectorscope, no
 * parade): the four tone sliders cannot be set without seeing where the light
 * sits and what has gone to white or to black, and nothing else is needed for
 * that. The maintainer's call, 2026-09-15 (`docs/develop-tool.md` §8).
 *
 * Read off a SMALL copy of the graded picture (`HISTOGRAM_SAMPLE_EDGE`): a
 * histogram's shape does not change with the pixel count, and reading a stage
 * frame back every slider step would cost tens of megabytes a step.
 *
 * Pure and DOM-free; the hook that reads the pixels is `use-develop-picture.ts`.
 */

/** How many bins the strip draws — a bar every few pixels on a 22rem column. */
export const HISTOGRAM_BINS = 64;
/** The long edge the picture is shrunk to before it is read. */
export const HISTOGRAM_SAMPLE_EDGE = 160;

/** Encoded values at or past which a channel counts as clipped to white / crushed to black. */
const WHITE = 254;
const BLACK = 1;

export interface Histogram {
  /** Pixels per luminance bin, dark to light. */
  bins: number[];
  /** Pixels read. */
  total: number;
  /** Share (0..1) of pixels with at least one channel at white: highlights gone. */
  clippedHighlights: number;
  /** Share (0..1) of pixels with every channel at black: shadows crushed. */
  crushedShadows: number;
}

/**
 * The histogram of RGBA bytes (a canvas's `ImageData.data`). Luminance is the
 * Rec.709 weighting of the ENCODED values — what the eye reads off a screen,
 * which is where a develop is judged — and alpha is ignored: the sample is an
 * opaque copy of a photograph.
 */
export function luminanceHistogram(rgba: ArrayLike<number>, binCount = HISTOGRAM_BINS): Histogram {
  const count = Math.max(1, Math.floor(binCount));
  const bins = new Array<number>(count).fill(0);
  const pixels = Math.floor(rgba.length / 4);
  let highs = 0;
  let lows = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    bins[Math.min(count - 1, Math.max(0, Math.floor((y * count) / 256)))] += 1;
    if (r >= WHITE || g >= WHITE || b >= WHITE) highs += 1;
    else if (r <= BLACK && g <= BLACK && b <= BLACK) lows += 1;
  }
  return {
    bins,
    total: pixels,
    clippedHighlights: pixels ? highs / pixels : 0,
    crushedShadows: pixels ? lows / pixels : 0,
  };
}

/**
 * Bar heights 0..1 for drawing. Scaled on the tallest INNER bin, the way every
 * developer draws it: a sky blown to white or a black border piles thousands of
 * pixels into an end bin, and scaling on that spike would flatten the whole
 * shape against the floor. The end bins are then capped at the top — their
 * excess is what the clip marks say in words.
 */
export function histogramShape(histogram: Histogram): number[] {
  const { bins } = histogram;
  const inner = bins.length > 2 ? bins.slice(1, -1) : bins;
  const peak = Math.max(0, ...inner) || Math.max(0, ...bins);
  if (peak <= 0) return bins.map(() => 0);
  return bins.map((n) => Math.min(1, n / peak));
}

/** "2.1 %", or "<0.1 %" for a sliver still worth saying, or null when there is none. */
export function clipLabel(share: number): string | null {
  if (!(share > 0)) return null;
  if (share < 0.001) return '<0.1 %';
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)} %`;
}
