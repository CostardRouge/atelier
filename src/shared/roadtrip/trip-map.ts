/**
 * The trip seen as a MAP — the arithmetic of the overview's second view
 * (2026-09-29, the maintainer: *«in trips i would like a map view, have a way
 * to toggle between calendar and map view»*; designed in a lab and then
 * *«go ahead and build it, with the coastline»*).
 *
 * **The unit on the map is the STAGE, never the day.** A place carries no
 * dates (`roadtrip.md`, «A stage is a LEG»): "Uluru on the 12th" inside a
 * nine-day leg would be a stage under another name. So a day cannot be pinned
 * inside a stage, and the map shows each stage once, at its place — or
 * halfway along its path when it holds several — wearing a DIAL of its days.
 *
 * The route runs in lived order, and a stretch of it is DOTTED where the
 * trip cannot account for its days: days no stage covers, or a stage whose
 * place has no position (typed by hand, which is a complete place, just not a
 * point). What cannot be placed is COUNTED (`offMap`), never guessed — the
 * rule Virée and the Itinerary already follow.
 *
 * Pure and DOM-free: positions on screen are handed in, never measured here.
 */

import { rulerBars, rulerGaps, type RulerGap } from './stage-ruler';
import { stageLabel } from './trip-places';
import type { TripDoc, TripStage } from './trip-types';
import type { IsoDate } from './trip-days';
import { addDays } from './trip-days';

export interface MapPoint {
  lat: number;
  lon: number;
}

export interface MapPlace extends MapPoint {
  name: string;
}

/** One stage as the map draws it. */
export interface MapStage {
  stage: TripStage;
  /** Its position in `trip.stages` — what picks its tint, like the ruler's bars. */
  index: number;
  /** `stageLabel`, possibly empty (an unnamed stage says so where it is drawn). */
  label: string;
  /** Its places that HAVE a position, in lived order. */
  places: MapPlace[];
  /** Where its dial sits: the one place, or halfway along its path. Null when nothing is located. */
  anchor: MapPoint | null;
  /** The day offset of its first day inside the trip, and how many of its days lie inside. */
  from: number;
  length: number;
  /** Its days inside the trip, in order. */
  dates: IsoDate[];
}

/** A stretch of road from one located stage to the next. */
export interface MapRoad {
  from: MapStage;
  to: MapStage;
  /** Where it leaves (the last place of `from`) and where it arrives (the first of `to`). */
  a: MapPoint;
  b: MapPoint;
  /** Stages between the two that have no position — their days happened somewhere along here. */
  unplaced: MapStage[];
  /** Days between the two that no stage covers. */
  gapDays: number;
  /** Drawn dotted: the trip cannot account for some of the days on this stretch. */
  dotted: boolean;
}

/** What the map cannot show, counted. */
export interface OffMap {
  /** Stages with no located place at all. */
  unplaced: MapStage[];
  /** Runs of days no stage covers. */
  gaps: RulerGap[];
  gapDays: number;
}

export interface TripMap {
  /** Every stage with at least one day inside the trip, in lived order (by first day). */
  stages: MapStage[];
  roads: MapRoad[];
  offMap: OffMap;
}

const RAD = Math.PI / 180;

/**
 * The point halfway along a path, measured on a flat map scaled by the
 * cosine of the path's own latitude — near enough for a stage's few hundred
 * kilometres, and it lands ON the drawn line rather than at a centroid in the
 * sea beside a curved coast road.
 */
export function pathMidpoint(points: readonly MapPoint[]): MapPoint | null {
  if (!points.length) return null;
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon };
  const cos = Math.cos((points.reduce((s, p) => s + p.lat, 0) / points.length) * RAD);
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const l = Math.hypot((points[i].lon - points[i - 1].lon) * cos, points[i].lat - points[i - 1].lat);
    seg.push(l);
    total += l;
  }
  if (total === 0) return { lat: points[0].lat, lon: points[0].lon };
  let left = total / 2;
  for (let i = 0; i < seg.length; i += 1) {
    if (left <= seg[i] || i === seg.length - 1) {
      const u = seg[i] ? Math.min(1, left / seg[i]) : 0;
      return {
        lat: points[i].lat + (points[i + 1].lat - points[i].lat) * u,
        lon: points[i].lon + (points[i + 1].lon - points[i].lon) * u,
      };
    }
    left -= seg[i];
  }
  return { lat: points[points.length - 1].lat, lon: points[points.length - 1].lon };
}

function located(stage: TripStage): MapPlace[] {
  return stage.places.flatMap((p) =>
    p.coords && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lon)
      ? [{ name: p.name, lat: p.coords.lat, lon: p.coords.lon }]
      : [],
  );
}

/**
 * The trip as the map draws it. A stage with a bad span, or entirely outside
 * the trip, is left out — the ruler's rule (`rulerBars`): it exists, the
 * editor lists it, but there is no honest place to draw its days.
 */
export function tripMap(trip: Pick<TripDoc, 'startDate' | 'endDate' | 'stages'>): TripMap {
  const bars = rulerBars(trip);
  const stages: MapStage[] = bars
    .map((bar) => {
      const places = located(bar.stage);
      const dates: IsoDate[] = [];
      for (let i = 0; i < bar.length; i += 1) {
        const date = addDays(trip.startDate, bar.from + i);
        if (date) dates.push(date);
      }
      return {
        stage: bar.stage,
        index: bar.index,
        label: stageLabel(bar.stage),
        places,
        anchor: pathMidpoint(places),
        from: bar.from,
        length: bar.length,
        dates,
      };
    })
    // Lived order: by first day, the list's own order breaking a tie.
    .sort((p, q) => p.from - q.from || p.index - q.index);

  const gaps = rulerGaps(trip, bars);
  const roads: MapRoad[] = [];
  let previous: MapStage | null = null;
  for (const current of stages) {
    if (!current.anchor) continue;
    if (previous) {
      const prev: MapStage = previous;
      const prevEnd = prev.from + prev.length - 1;
      const unplaced = stages.filter(
        (s) => !s.anchor && s.from > prev.from && s.from < current.from,
      );
      const gapDays = gaps
        .filter((g) => g.from > prevEnd && g.from + g.length - 1 < current.from)
        .reduce((n, g) => n + g.length, 0);
      roads.push({
        from: prev,
        to: current,
        a: prev.places[prev.places.length - 1],
        b: current.places[0],
        unplaced,
        gapDays,
        dotted: unplaced.length > 0 || gapDays > 0,
      });
    }
    previous = current;
  }

  return {
    stages,
    roads,
    offMap: {
      unplaced: stages.filter((s) => !s.anchor),
      gaps,
      gapDays: gaps.reduce((n, g) => n + g.length, 0),
    },
  };
}

/**
 * Where the open day sits in the story, as an index into `stages` (lived
 * order): the stage covering the day — the LAST one on a travel day, as
 * `stageAt` resolves it — else the last one ended before it; −1 before the
 * first. The road is drawn solid up to this stage and pale after it.
 */
export function progressIndex(stages: readonly MapStage[], dayOffset: number): number {
  let covering = -1;
  let before = -1;
  stages.forEach((s, i) => {
    if (dayOffset >= s.from && dayOffset < s.from + s.length) {
      if (covering < 0 || s.index > stages[covering].index) covering = i;
    } else if (s.from + s.length - 1 < dayOffset) {
      before = i;
    }
  });
  return covering >= 0 ? covering : before;
}

/** A dial's radius at a map zoom: legible at a continent, generous at a coast. */
export function dialRadius(zoom: number): number {
  return Math.round(Math.max(9, Math.min(22, 9 + (zoom - 3) * 3)));
}

/**
 * One tick of a dial as an SVG path: an annular sector from `a0` to `a1`
 * (radians, clockwise from the x axis, y down) between radii `r0` and `r1`.
 */
export function wedgePath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const at = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${at(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${at(r1, a1)}L${at(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${at(r0, a0)}Z`;
}

/** The angles of a dial's `n` ticks, the first at twelve o'clock, clockwise. */
export function dialAngles(n: number): { a0: number; a1: number }[] {
  const step = (2 * Math.PI) / Math.max(1, n);
  return Array.from({ length: Math.max(0, n) }, (_, i) => {
    const a0 = -Math.PI / 2 + i * step;
    return { a0, a1: a0 + step };
  });
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Anchors pushed apart until none sits within `min` pixels of another — two
 * stages at one place (the maintainer's two stays in Cairns) must be two
 * dials, each tied back to the place by a hairline where it moved. Identical
 * points split sideways, the later to the right, so the order reads left to
 * right. Bounded, so it cannot cycle.
 */
export function spreadAnchors(points: readonly ScreenPoint[], min: number, rounds = 12): ScreenPoint[] {
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  for (let round = 0; round < rounds; round += 1) {
    let moved = false;
    for (let a = 0; a < out.length; a += 1) {
      for (let b = a + 1; b < out.length; b += 1) {
        let dx = out[b].x - out[a].x;
        let dy = out[b].y - out[a].y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (min - d) / 2;
        out[a].x -= (dx / d) * push;
        out[a].y -= (dy / d) * push;
        out[b].x += (dx / d) * push;
        out[b].y += (dy / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelAsk {
  /**
   * The mark it names, and the room the mark takes around its centre. A
   * mark's own box in `marks` must reach no further than `radius + 3`.
   */
  x: number;
  y: number;
  radius: number;
  text: string;
  /** Drawn even where it collides — the open stage is never unnamed. */
  force?: boolean;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Names beside their marks: right, then left, then above, then below — the
 * first spot that touches no mark, no name already placed, no `reserved` box
 * (the map's own controls) and stays inside the view. A name that fits
 * nowhere is left out rather than drawn over something, unless it is forced.
 * Asks are placed in the order given, so the caller lists what must win.
 */
export function placeLabels(
  asks: readonly LabelAsk[],
  marks: readonly LabelBox[],
  reserved: readonly LabelBox[],
  view: { width: number; height: number },
  charPx = 6.2,
  height = 15,
): (LabelBox | null)[] {
  const taken: LabelBox[] = [...marks, ...reserved];
  return asks.map((ask) => {
    if (!ask.text) return null;
    const width = Math.ceil(ask.text.length * charPx) + 6;
    const gap = 4;
    const spots: LabelBox[] = [
      { x: ask.x + ask.radius + gap, y: ask.y - height / 2, width, height },
      { x: ask.x - ask.radius - gap - width, y: ask.y - height / 2, width, height },
      { x: ask.x - width / 2, y: ask.y - ask.radius - gap - height, width, height },
      { x: ask.x - width / 2, y: ask.y + ask.radius + gap, width, height },
    ];
    const inside = (b: LabelBox) => b.x >= 2 && b.y >= 2 && b.x + b.width <= view.width - 2 && b.y + b.height <= view.height - 2;
    // Every spot starts `gap` past the mark's radius, so the mark's own box
    // (radius + a margin under `gap`) is never in its way.
    const spot = spots.find((s) => inside(s) && !taken.some((t) => overlaps(s, t)));
    const chosen = spot ?? (ask.force ? spots[0] : null);
    if (chosen) taken.push(chosen);
    return chosen;
  });
}
