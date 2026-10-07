/**
 * Défilé's RIBBON under Virée's map (2026-10-07, §5 of
 * `docs/map-openers-next.md`, the recap lab's «le ruban des jours»): the
 * trip's measuring tape, one tick a day and a long one where a leg starts,
 * its head advancing with the car on the recap's day clock — the counter,
 * the car and the head read the same day, so the head stands over day k
 * exactly while the badge says day k.
 *
 * Drawn by Défilé's own painter (`paintTape`), on a geometry placed here:
 * under the map's box, past the scale bar and the distance, its ticks
 * hanging down; ABOVE the box, ticks up, where the frame has no room below
 * (a landscape frame, a map at the bottom).
 *
 * Not an opener STACK: the ribbon reads Virée's clock and Virée's box, which
 * no contract between two layers carries, so it is an option of the drive
 * that borrows Défilé's tape — the stack keeps its storage and still has no
 * screen (`docs/hook-engine.md` §6). Pure: no canvas here.
 */

import type { HookDay } from './hook-variant';
import { tapeGeometry, type TapeGeometry } from './scrub-plan';
import type { TapeReading, TapeStyle } from './scrub-paint';
import type { DriveOptions, DrivePlan } from './drive-plan';

/** The gap between the map's box and the ribbon, in 1080-frame units, with nothing between them… */
const GAP = 28;
/** …past a plate's margin… */
const GAP_PLATED = 40;
/** …and past the scale bar and the distance, which sit right under the box. */
const GAP_UNDER_LABELS = 100;
/** The least room left between the ribbon's band and the frame's edge. */
const EDGE = 8;

/** The ribbon's reader: the trip's days and its leg starts, and the day under the head at `t`. */
export interface DriveRibbon {
  totalDays: number;
  legStarts: readonly number[];
  at(t: number): TapeReading;
}

/**
 * What the ribbon reads, or null where it has nothing true to show: no recap
 * clock (the badge counts something else, or no stop is dated) or a trip of
 * one day.
 */
export function driveRibbon(plan: DrivePlan, calendar: readonly HookDay[]): DriveRibbon | null {
  const totalDays = calendar.length;
  if (!plan.clock || totalDays < 2) return null;
  const legStarts = calendar.filter((day) => day.legStart).map((day) => day.dayNumber);
  return {
    totalDays,
    legStarts,
    at(t) {
      // The clock runs from the morning of day 1 to the end of the last day;
      // the head stands on day k from its morning, so it holds on the last.
      const day = plan.at(t).day ?? 1;
      return { totalDays, legStarts, headDay: Math.max(1, Math.min(totalDays, day)) };
    },
  };
}

/**
 * Where the ribbon sits on a frame of `w`×`h`, around the map's `box`: under
 * it when the band fits, else above it. The tape is as wide as the box.
 */
export function ribbonGeometry(
  w: number,
  h: number,
  box: { x: number; y: number; width: number; height: number },
  o: Pick<DriveOptions, 'scaleBar' | 'distance'>,
  plated: boolean,
): TapeGeometry {
  const u = w / 1080;
  const tapeWidth = Math.max(0.05, Math.min(1, box.width / w));
  const labels = o.scaleBar || o.distance !== 'off';
  const below = box.y + box.height + (labels ? GAP_UNDER_LABELS : plated ? GAP_PLATED : GAP) * u;
  const under = tapeGeometry(w, h, { tape: 'top', tapeWidth, edgeOffset: below / h });
  if (under.band.y + under.band.height <= h - EDGE * u) return under;
  const above = box.y - (plated ? GAP_PLATED : GAP) * u;
  return tapeGeometry(w, h, { tape: 'bottom', tapeWidth, edgeOffset: 1 - above / h });
}

/**
 * How the ribbon is drawn: inked like the map on its paper — ink ahead, the
 * trail's colour passed — and, where it lies over a picture rather than the
 * paper, Défilé's white ticks on a dark band so it reads on anything.
 */
export function ribbonStyle(o: Pick<DriveOptions, 'inkColor' | 'trailColor'>, overPicture: boolean): TapeStyle {
  return {
    tickColor: overPicture ? '#ffffff' : o.inkColor,
    passedColor: o.trailColor,
    tickOpacity: overPicture ? 0.6 : 0.45,
    tickGap: 6,
    showTrack: true,
    tapeBackground: overPicture,
    backgroundOpacity: 0.45,
    edgeFade: false,
    headStyle: 'bar',
    headGlow: true,
  };
}
