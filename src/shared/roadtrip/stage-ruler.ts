/**
 * The geometry of the stage ruler — the trip's legs laid along one horizontal
 * track, DaVinci-style, under the calendar grid.
 *
 * Everything here is in DAY OFFSETS from the trip's first day: a bar starts at
 * offset `from` and covers `length` days, so the component only multiplies by
 * a pixel width. A stage that reaches outside the trip is CLIPPED to it for
 * drawing and never rewritten — the ruler shows the trip, the stage keeps its
 * own dates until the author drags them.
 *
 * Pure and DOM-free.
 */

import { addDays, daysBetween, parseIsoDate, spanLength, type IsoDate } from './trip-days';
import type { TripDoc, TripStage } from './trip-types';

export interface RulerBar {
  stage: TripStage;
  /** Position of the stage in `trip.stages` — what picks its tint. */
  index: number;
  /** 0-based day offset from the trip's first day, after clipping. */
  from: number;
  /** Days covered inside the trip, at least 1. */
  length: number;
  /** Row on the track; overlapping legs (a travel day) stack downwards. */
  lane: number;
}

/** A run of days no stage covers, where the ruler offers to add one. */
export interface RulerGap {
  from: number;
  length: number;
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface RulerMonth {
  /** Day offset the label sits at. */
  offset: number;
  label: string;
}

/** One stroke of the track's scale — a day, or a week when days crowd. */
export interface RulerTick {
  /** Day offset the stroke stands at. */
  offset: number;
  /** A Monday or a first of the month — drawn taller. */
  strong: boolean;
}

/**
 * Four muted tints, one per leg in turn, so two adjacent legs never share a
 * colour. Chosen in oklch at the same lightness and chroma so no leg shouts
 * over another, and kept well away from the vermilion accent: the accent
 * means "selected" everywhere in the suite and a leg must not look selected
 * because it happens to be third.
 */
export const STAGE_TINTS = [
  'oklch(72% 0.07 250)',
  'oklch(72% 0.07 150)',
  'oklch(72% 0.07 65)',
  'oklch(72% 0.07 320)',
] as const;

export function stageTint(index: number): string {
  return STAGE_TINTS[((index % STAGE_TINTS.length) + STAGE_TINTS.length) % STAGE_TINTS.length];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The trip's stages as bars on the track, in `trip.stages` order. A stage
 * with a bad or reversed span, or one entirely outside the trip, has no bar
 * — it still exists, and the editor still lists it, but the ruler has nowhere
 * honest to draw it.
 *
 * Lanes are assigned greedily: a bar takes the first lane where nothing
 * already drawn overlaps it. Stages that overlap on purpose (a travel day
 * belongs to both legs) therefore stack rather than hide one another.
 */
export function rulerBars(trip: Pick<TripDoc, 'startDate' | 'endDate' | 'stages'>): RulerBar[] {
  const total = spanLength(trip.startDate, trip.endDate);
  if (total === null) return [];
  const bars: RulerBar[] = [];
  const laneEnds: number[] = []; // exclusive end offset of the last bar per lane
  trip.stages.forEach((stage, index) => {
    if (spanLength(stage.startDate, stage.endDate) === null) return;
    const start = daysBetween(trip.startDate, stage.startDate);
    const end = daysBetween(trip.startDate, stage.endDate);
    if (start === null || end === null) return;
    const from = Math.max(0, start);
    const to = Math.min(total - 1, end);
    if (to < from) return;
    const length = to - from + 1;
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] > from) lane += 1;
    laneEnds[lane] = from + length;
    bars.push({ stage, index, from, length, lane });
  });
  return bars;
}

export function laneCount(bars: readonly RulerBar[]): number {
  return bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
}

/** The days of the trip no bar covers, as runs. Empty when fully covered. */
export function rulerGaps(
  trip: Pick<TripDoc, 'startDate' | 'endDate'>,
  bars: readonly RulerBar[],
): RulerGap[] {
  const total = spanLength(trip.startDate, trip.endDate);
  if (total === null) return [];
  const covered = new Array<boolean>(total).fill(false);
  for (const bar of bars) {
    for (let i = bar.from; i < bar.from + bar.length; i += 1) covered[i] = true;
  }
  const gaps: RulerGap[] = [];
  let runFrom = -1;
  const close = (end: number) => {
    if (runFrom < 0) return;
    gaps.push({
      from: runFrom,
      length: end - runFrom,
      startDate: offsetToDate(trip.startDate, runFrom),
      endDate: offsetToDate(trip.startDate, end - 1),
    });
    runFrom = -1;
  };
  covered.forEach((on, i) => {
    if (!on && runFrom < 0) runFrom = i;
    if (on) close(i);
  });
  close(total);
  return gaps;
}

/**
 * Month labels along the track: the trip's own first day, then every first
 * of a month inside it. The first label is placed at offset 0 even when the
 * trip joins a month midway, for the same reason the grid does — an
 * unlabelled leading stretch reads as "no month".
 */
export function rulerMonths(trip: Pick<TripDoc, 'startDate' | 'endDate'>): RulerMonth[] {
  const total = spanLength(trip.startDate, trip.endDate);
  const start = parseIsoDate(trip.startDate);
  if (total === null || start === null) return [];
  const out: RulerMonth[] = [];
  for (let i = 0; i < total; i += 1) {
    const d = new Date(start + i * 86_400_000);
    if (i === 0 || d.getUTCDate() === 1) {
      out.push({ offset: i, label: MONTHS[d.getUTCMonth()] });
    }
  }
  return out;
}

/**
 * Narrowest two strokes of the scale may stand apart. Below it a run of day
 * ticks stops reading as days and becomes a grey band, so the scale steps up
 * to weeks instead of drawing them all.
 */
export const MIN_TICK_GAP = 9;

/**
 * The day strokes along the track, for the day width actually drawn. Days
 * while they fit; Mondays alone once they do not — real Mondays, not every
 * seventh day of the trip, so the rhythm means something to read against.
 * Offset 0 is never a stroke: it is the trip's own edge, where the first
 * month rule already stands.
 */
export function rulerTicks(
  trip: Pick<TripDoc, 'startDate' | 'endDate'>,
  dayWidth: number,
): RulerTick[] {
  const total = spanLength(trip.startDate, trip.endDate);
  const start = parseIsoDate(trip.startDate);
  if (total === null || start === null) return [];
  const everyDay = dayWidth >= MIN_TICK_GAP;
  if (!everyDay && dayWidth * 7 < MIN_TICK_GAP) return [];
  const out: RulerTick[] = [];
  for (let i = 1; i < total; i += 1) {
    const d = new Date(start + i * 86_400_000);
    const monday = d.getUTCDay() === 1;
    const firstOfMonth = d.getUTCDate() === 1;
    if (everyDay) out.push({ offset: i, strong: monday || firstOfMonth });
    else if (monday) out.push({ offset: i, strong: true });
  }
  return out;
}

/**
 * Narrowest a day may be drawn at 100%. A bar thinner than this cannot be
 * grabbed by an edge, so it is the BASE the zoom multiplies, not a clamp
 * applied after it: clamping after froze the whole track — a 616-day trip in a
 * 460px box drew the same 3696px picture from 25% to 800%, while the zoom's
 * scroll correction kept moving as if it had grown.
 */
export const MIN_DAY = 6;

/** A day's width on the track: the box's share of it, or 6px, times the zoom. */
export function rulerDayWidth(viewportWidth: number, total: number, scale: number): number {
  const fitted = viewportWidth > 0 && total > 0 ? viewportWidth / total : MIN_DAY;
  return Math.max(MIN_DAY, fitted) * scale;
}

/** The whole track's width — what tells the zoom how much the content grew. */
export function rulerTrackWidth(viewportWidth: number, total: number, scale: number): number {
  return rulerDayWidth(viewportWidth, total, scale) * total;
}

/** The day at a fraction of the track's width, clamped to the trip. */
export function dayAtOffset(
  trip: Pick<TripDoc, 'startDate' | 'endDate'>,
  offset: number,
): IsoDate | null {
  const total = spanLength(trip.startDate, trip.endDate);
  if (total === null) return null;
  const i = Math.max(0, Math.min(total - 1, Math.floor(offset)));
  return offsetToDate(trip.startDate, i);
}

/** 0-based offset of a date from the trip's first day, or null off the trip. */
export function dayOffset(
  trip: Pick<TripDoc, 'startDate' | 'endDate'>,
  date: IsoDate,
): number | null {
  const total = spanLength(trip.startDate, trip.endDate);
  const i = daysBetween(trip.startDate, date);
  if (total === null || i === null || i < 0 || i >= total) return null;
  return i;
}

function offsetToDate(start: IsoDate, offset: number): IsoDate {
  // The callers have already checked the span, so the date is always real.
  return addDays(start, offset) ?? start;
}
