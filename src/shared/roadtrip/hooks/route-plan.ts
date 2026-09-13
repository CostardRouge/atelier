/**
 * The route trace's arithmetic — the trip's own shape, as far as it is known.
 *
 * The route is the legs' LOCATED places joined in the order they were lived.
 * Three readings decide what it says, and each is a refusal to claim more than
 * the document holds:
 *
 * - **The piece sits on a LEG, never on a point.** A place has no dates of its
 *   own, and the badge's caption names the leg (`stageLabel`), not a spot on
 *   it. So the trace marks the leg this day belongs to — never a "you are
 *   here" pin it could not justify. The single exception is a leg with one
 *   located place, where the leg IS that point.
 * - **Past, current, future.** Legs lived before this day are drawn solid, the
 *   current one in the accent, the ones still ahead faint. The trip's shape
 *   grows as a year of pieces is told, which is what makes a series
 *   recognisable before a word is read.
 * - **A place with no coordinates is simply not on the line.** It is a complete
 *   place (typed by hand is the normal case); it just cannot be drawn.
 *
 * The segment that travels from one leg into the next belongs to the leg it
 * ARRIVES in. Pure and DOM-free; projection is equirectangular with the
 * longitude scaled by the cosine of the mean latitude, which is honest at the
 * scale of a country and needs no map.
 */

import type { HookStage } from './hook-variant';

export type LegState = 'past' | 'current' | 'future';
export type RouteScope = 'trip' | 'leg';

export interface RoutePoint {
  lat: number;
  lon: number;
  name: string;
}

/** One stretch of the line: from the previous point to this one. */
export interface RouteSegment {
  from: RoutePoint;
  to: RoutePoint;
  state: LegState;
}

export interface RouteShape {
  /** Every located place drawn, in order, with the state of its leg. */
  points: { point: RoutePoint; state: LegState }[];
  segments: RouteSegment[];
  /** The one place to ring — only when the current leg has exactly one. */
  ring: RoutePoint | null;
  /** How many legs the route crosses, and which (1-based) this day is on. */
  legCount: number;
  currentLeg: number | null;
}

/** Which leg a day belongs to: the LAST match, the rule `stageAt` uses. */
export function currentLegIndex(stages: readonly HookStage[], date: string): number | null {
  let found: number | null = null;
  stages.forEach((stage, i) => {
    if (stage.startDate <= date && date <= stage.endDate) found = i;
  });
  return found;
}

function sameSpot(a: RoutePoint, b: RoutePoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

/** The route for a day, over the whole trip or its current leg alone. */
export function routeShape(
  stages: readonly HookStage[],
  date: string,
  scope: RouteScope,
): RouteShape {
  const current = currentLegIndex(stages, date);
  const legs = stages
    .map((stage, i) => ({
      stage,
      index: i,
      state: (current === null ? 'past' : i < current ? 'past' : i === current ? 'current' : 'future') as LegState,
    }))
    .filter(({ index }) => scope === 'trip' || index === current);

  const points: RouteShape['points'] = [];
  const segments: RouteSegment[] = [];
  let previous: RoutePoint | null = null;
  for (const { stage, state } of legs) {
    for (const place of stage.places) {
      const point = { lat: place.lat, lon: place.lon, name: place.name };
      if (previous && sameSpot(previous, point)) continue;
      if (previous) segments.push({ from: previous, to: point, state });
      points.push({ point, state });
      previous = point;
    }
  }

  const currentPlaces = current === null ? [] : stages[current].places;
  return {
    points,
    segments,
    ring:
      currentPlaces.length === 1
        ? { lat: currentPlaces[0].lat, lon: currentPlaces[0].lon, name: currentPlaces[0].name }
        : null,
    legCount: stages.length,
    currentLeg: current === null ? null : current + 1,
  };
}

/** Located places across the whole trip, distinct spots only. */
export function locatedSpots(stages: readonly HookStage[]): number {
  const spots: RoutePoint[] = [];
  for (const stage of stages) {
    for (const place of stage.places) {
      const point = { lat: place.lat, lon: place.lon, name: place.name };
      if (!spots.some((spot) => sameSpot(spot, point))) spots.push(point);
    }
  }
  return spots.length;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A projection that fits every point of `shape` inside `box`, aspect kept and
 * centred. North is up. A shape of one spot (or none) sits in the middle.
 */
export function fitProjection(
  points: readonly RoutePoint[],
  box: Box,
): (point: RoutePoint) => { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (points.length === 0) return () => ({ x: cx, y: cy });

  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const px = (p: RoutePoint) => p.lon * k;
  const py = (p: RoutePoint) => -p.lat;

  const xs = points.map(px);
  const ys = points.map(py);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 1e-9 && spanY < 1e-9) return () => ({ x: cx, y: cy });

  const scale = Math.min(
    spanX > 1e-9 ? box.width / spanX : Infinity,
    spanY > 1e-9 ? box.height / spanY : Infinity,
  );
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return (p) => ({ x: cx + (px(p) - midX) * scale, y: cy + (py(p) - midY) * scale });
}

/**
 * How much of the line's DRAWN length (past and current legs — the trip so
 * far) is revealed at `progress` 0..1, per segment: 1 for a segment fully
 * drawn, a fraction for the one the pen is on, 0 ahead of it. Future legs are
 * not part of the pen's path; they fade in once it has arrived.
 */
export function revealFractions(
  lengths: readonly number[],
  states: readonly LegState[],
  progress: number,
): number[] {
  const drawn = lengths.map((length, i) => (states[i] === 'future' ? 0 : length));
  const total = drawn.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return lengths.map((_, i) => (states[i] === 'future' ? 0 : 1));
  let budget = Math.max(0, Math.min(1, progress)) * total;
  return drawn.map((length, i) => {
    if (states[i] === 'future') return 0;
    if (length <= 0) return budget > 0 ? 1 : 0;
    const take = Math.min(length, budget);
    budget -= take;
    return take / length;
  });
}

/** The pen's ease: quick away from the start, settling onto the current leg. */
export function drawProgress(t: number, seconds: number): number {
  if (seconds <= 0) return 1;
  const u = Math.max(0, Math.min(1, t / seconds));
  return 1 - (1 - u) ** 3;
}
