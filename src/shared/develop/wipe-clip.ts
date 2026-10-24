/**
 * Where the A/B's BEFORE layer is cut, as a CSS `clip-path`.
 *
 * The untouched picture is a canvas of its own laid over the graded one, the
 * same box, the same `object-contain` and the same transform — so moving the
 * divider changes one clip and redraws nothing (`use-develop-picture.ts`,
 * «the wipe»). The clip is in the element's OWN coordinates, before its
 * transform: the zoom and the pan move the cut with the picture for free.
 *
 * `wipe` is the divider's place across the CANVAS (0..1 from the left, the
 * as-shot picture to its left), `canvas` the canvas's backing size and `box`
 * the element's CSS box, inside which `object-contain` letterboxes the
 * backing. Null when there is nothing to show — no split, or nothing measured
 * yet.
 */
export function beforeClip(
  wipe: number,
  canvas: { w: number; h: number } | null,
  box: { width: number; height: number },
): string | null {
  if (!(wipe > 0) || !canvas || !(canvas.w > 0) || !(canvas.h > 0) || !(box.width > 0) || !(box.height > 0)) {
    return null;
  }
  const scale = Math.min(box.width / canvas.w, box.height / canvas.h);
  const left = (box.width - canvas.w * scale) / 2;
  const cut = left + Math.min(1, wipe) * canvas.w * scale;
  return `inset(0 ${round2(box.width - cut)}px 0 0)`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
