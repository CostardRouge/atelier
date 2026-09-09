/**
 * How many pixels an editor stage actually works on.
 *
 * The stage used to draw at the media's own density, which is right for a clip
 * — 4K is 8.3 megapixels — and ruinous for a photograph: a 48-megapixel JPEG
 * off a drone put a 194 MB canvas on screen, and the moment a LUT was picked
 * the grader added a texture and a drawing buffer of the same size on the GPU.
 * On an iPhone that is the whole budget and the tab is killed.
 *
 * So the stage has a pixel budget: no more than a 4K frame, which leaves every
 * clip the studio was built for untouched and only bites on a big still. It is
 * a PREVIEW budget and nothing else — the exports and the frame grab compose
 * from the source bitmap at its own density, never from this canvas.
 */

/** A 4K frame's worth of pixels — the most any stage will work on. */
export const MAX_STAGE_PIXELS = 3840 * 2160;

/**
 * The frame size a stage should hold `w`×`h` in: the media's own size while it
 * is within the budget, scaled down by area — aspect kept — once it is not.
 */
export function stageFrameSize(
  w: number,
  h: number,
  budget = MAX_STAGE_PIXELS,
): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const pixels = w * h;
  if (!(budget > 0) || pixels <= budget) {
    return { w: Math.round(w), h: Math.round(h) };
  }
  const scale = Math.sqrt(budget / pixels);
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}
