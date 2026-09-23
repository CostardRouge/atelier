/**
 * Where a menu is drawn once it no longer lives inside its card.
 *
 * A menu positioned `absolute` inside a card is painted with that card, so a
 * later sibling in the grid paints OVER it — reported on the Develop gallery,
 * where the ⋯ menu of a roll slid under the roll beneath it — and the page's
 * own scroll container clips it at the bottom row. The cure is to draw it in a
 * portal at fixed viewport coordinates, which is what this module computes:
 * given the trigger's rect and the menu's measured size, the corner it opens
 * from, the height it may take, and the side it ended up on.
 *
 * `side` and `align` are therefore a PREFERENCE, not a placement: a menu that
 * would fall off the bottom flips above, and one that would fall off an edge
 * slides back in. A menu that fits nowhere keeps `MIN_ROOM` and scrolls —
 * better a short scrolling menu than one drawn past the screen.
 *
 * DOM-free and tested: nothing here reads an element, the caller measures.
 */

export interface AnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface MenuAnchorInput {
  /** The trigger, in viewport coordinates (`getBoundingClientRect`). */
  trigger: AnchorRect;
  /** The menu's natural size, measured unconstrained. */
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Preferred side; flipped when it does not fit. */
  side: 'below' | 'above';
  /** Which of the menu's edges lines up with the trigger's. */
  align: 'end' | 'start';
  /** Between the trigger and the menu. */
  gap?: number;
  /** The least the menu keeps from a viewport edge. */
  margin?: number;
}

export interface MenuAnchor {
  left: number;
  top: number;
  maxHeight: number;
  /** Where it actually landed — the caller may want to know it flipped. */
  placed: 'below' | 'above';
}

/** Two items and a rule: below this a menu is not worth drawing, it scrolls. */
const MIN_ROOM = 96;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function menuAnchor({
  trigger,
  menu,
  viewport,
  side,
  align,
  gap = 6,
  margin = 8,
}: MenuAnchorInput): MenuAnchor {
  const roomBelow = viewport.height - margin - (trigger.bottom + gap);
  const roomAbove = trigger.top - gap - margin;

  // Flip only when the preferred side cannot hold the menu AND the other side
  // is better — a menu that fits nowhere stays where it was asked for.
  let placed = side;
  if (side === 'below' && menu.height > roomBelow && roomAbove > roomBelow) placed = 'above';
  if (side === 'above' && menu.height > roomAbove && roomBelow > roomAbove) placed = 'below';

  const room = placed === 'below' ? roomBelow : roomAbove;
  const maxHeight = clamp(Math.max(room, MIN_ROOM), 0, Math.max(viewport.height - 2 * margin, 0));
  const height = Math.min(menu.height, maxHeight);

  const wantedTop = placed === 'below' ? trigger.bottom + gap : trigger.top - gap - height;
  const top = clamp(wantedTop, margin, Math.max(margin, viewport.height - margin - height));

  const wantedLeft = align === 'end' ? trigger.right - menu.width : trigger.left;
  const maxLeft = viewport.width - margin - menu.width;
  const left = maxLeft < margin ? margin : clamp(wantedLeft, margin, maxLeft);

  return { left, top, maxHeight, placed };
}
