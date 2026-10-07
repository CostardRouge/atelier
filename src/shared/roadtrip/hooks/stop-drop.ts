/**
 * What a stop DROPPED on a map does — decided by where it lands, never by a
 * mode (2026-10-07, the maintainer on the stops lab: «si je le déplace hors
 * d'une ligne et hors d'un autre point … ça déplace juste le lieu ; sur une
 * ligne, ça fait une insertion ; sur un numéro, ça fait un échange»):
 *
 * - on ANOTHER STOP → the two SWAP their places in the order; neither moves;
 * - on a LINE between two stops → the stop is INSERTED between them, where it
 *   stands on the map unchanged;
 * - anywhere else → the stop MOVES there, its number kept.
 *
 * A stop beats a line (a stop sits on the line it ends), and the two hops
 * that touch the dragged stop are not targets: inserting it next to itself
 * is no edit. The same rule is read live while the stop is held, so the map
 * can say what letting go will do.
 *
 * And a TAP on a line is the place a stop is added between two others
 * ({@link hopAt}). Pure, in screen pixels: each map projects its own stops.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** How near a stop's dot a drop must land to be ON it, in CSS pixels. */
export const DROP_ON_STOP_PX = 18;
/** How near a line a drop or a tap must land to be ON it. */
export const DROP_ON_LINE_PX = 10;

export type StopDrop =
  | { kind: 'move' }
  /** Trade places in the order with the stop at `index`. */
  | { kind: 'swap'; index: number }
  /** Go between the stops at `hop` and `hop + 1`. */
  | { kind: 'insert'; hop: number };

function distToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The distance from a point to a polyline. */
function distToPath(p: ScreenPoint, path: readonly ScreenPoint[]): number {
  if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i += 1) best = Math.min(best, distToSegment(p, path[i], path[i + 1]));
  return best;
}

export interface HopOptions {
  /** How each hop is drawn, when it is not straight (a bowed arc, sampled): `paths[i]` runs from stop i to i + 1. */
  paths?: readonly (readonly ScreenPoint[])[];
  linePx?: number;
  /** A stop whose own two hops are no target — the one being dragged. */
  except?: number;
}

/** The hop a point lies on — the nearest line within reach — or null. */
export function hopAt(stops: readonly ScreenPoint[], p: ScreenPoint, options: HopOptions = {}): number | null {
  const reach = options.linePx ?? DROP_ON_LINE_PX;
  let best: { hop: number; d: number } | null = null;
  for (let i = 0; i + 1 < stops.length; i += 1) {
    if (options.except !== undefined && (i === options.except || i + 1 === options.except)) continue;
    const path = options.paths?.[i] ?? [stops[i], stops[i + 1]];
    const d = distToPath(p, path);
    if (d <= reach && (!best || d < best.d)) best = { hop: i, d };
  }
  return best?.hop ?? null;
}

/**
 * What letting go of the stop at `index` at `p` does. `stops` are every
 * stop's dot on screen, the held one included at its OLD place.
 */
export function resolveDrop(
  stops: readonly ScreenPoint[],
  index: number,
  p: ScreenPoint,
  options: { stopPx?: number; linePx?: number; paths?: HopOptions['paths'] } = {},
): StopDrop {
  const reach = options.stopPx ?? DROP_ON_STOP_PX;
  let near: { index: number; d: number } | null = null;
  stops.forEach((s, i) => {
    if (i === index) return;
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d <= reach && (!near || d < near.d)) near = { index: i, d };
  });
  if (near) return { kind: 'swap', index: (near as { index: number }).index };
  const hop = hopAt(stops, p, { paths: options.paths, linePx: options.linePx, except: index });
  return hop === null ? { kind: 'move' } : { kind: 'insert', hop };
}

/** Two stops trading places in the order; anything out of range is a copy. */
export function swapAt<T>(list: readonly T[], a: number, b: number): T[] {
  const out = [...list];
  if (a < 0 || b < 0 || a >= out.length || b >= out.length || a === b) return out;
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

/** The stop at `index` moved between the stops at `hop` and `hop + 1`. */
export function insertAtHop<T>(list: readonly T[], index: number, hop: number): T[] {
  const out = [...list];
  if (index < 0 || index >= out.length || hop < 0 || hop + 1 >= out.length) return out;
  if (index === hop || index === hop + 1) return out;
  const [moved] = out.splice(index, 1);
  // Past the removal, the hop's second stop sits one place earlier when the
  // stop came from before it.
  out.splice(index < hop + 1 ? hop : hop + 1, 0, moved);
  return out;
}

/** What letting go will do, in one line — said on the map while the stop is held. */
export function dropLine(
  drop: StopDrop,
  name: (index: number) => string,
  index: number,
): string {
  const who = name(index) || `Stop ${index + 1}`;
  if (drop.kind === 'swap') return `Let go to swap ${who} with ${drop.index + 1} ${name(drop.index)}`.trim();
  if (drop.kind === 'insert') {
    const to = index < drop.hop + 1 ? drop.hop + 1 : drop.hop + 2;
    return `Let go to make ${who} number ${to}, between ${drop.hop + 1} and ${drop.hop + 2}`;
  }
  return `Let go to move ${who} here`;
}
