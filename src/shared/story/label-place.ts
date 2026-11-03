/**
 * Where a map's name goes so it never writes over another (measured on his
 * real trip: Parramatta and Sydney, a few kilometres apart, wrote their
 * names on one line, one over the other). Each name tries its places in
 * order — its usual one, above its dot, then on the other side — and takes
 * the first clear of the names already placed in this frame; with none
 * clear it is left out, its dot still drawn. Earlier stops of the route
 * place first, so the trip's own order decides. (pure)
 */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room kept between two names, in the map's units. */
export const LABEL_GAP = 4;

const overlaps = (a: LabelBox, b: LabelBox, gap = LABEL_GAP) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The first of `candidates` clear of every box in `placed`, its index, or null — the chosen box is added to `placed`. (pure over `placed`) */
export function placeLabel(candidates: readonly LabelBox[], placed: LabelBox[]): { box: LabelBox; at: number } | null {
  for (let i = 0; i < candidates.length; i++) {
    const box = candidates[i];
    if (!placed.some((p) => overlaps(box, p))) {
      placed.push(box);
      return { box, at: i };
    }
  }
  return null;
}
