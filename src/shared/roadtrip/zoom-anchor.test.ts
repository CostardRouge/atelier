/**
 * The day under the pointer must not move while the zoom runs.
 *
 * This is the by-hand browser measurement — read the fraction of the content
 * under a fixed point, zoom, read it again — encoded against a scroll box
 * simulated exactly as a browser clamps one. It is the only test that catches
 * the class of bug that shipped twice: a correction that assumes the content
 * grew by the ratio of the two scales, when the zone it corrects has a pixel
 * floor (the ruler's 6px day) or rounds to whole pixels (the grid's cells).
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_STAGE_ZOOM,
  growthRatio,
  minScaleToFill,
  scrollAfterZoom,
  stepZoom,
  zoomFloor,
} from '../ui/stage-zoom';
import { HEATMAP_FIXED, heatmapWidth } from './day-grid';
import { rulerTrackWidth } from './stage-ruler';

interface Zone {
  /** The scaling content's width at a scale — the zone's own geometry. */
  width: (scale: number) => number;
  /** Content before it that never scales (the grid's weekday rail). */
  fixed: number;
  viewport: number;
  /** A floor the zone declares whatever its content does (the ruler's 100%). */
  minScale?: number;
}

/**
 * Zoom one notch at a time across the zone's whole range, holding a point 40%
 * into the box, and report the worst drift of the content fraction under it.
 * A browser's scroll box is the whole simulation: it clamps to
 * `[0, content - viewport]` and pins at 0 while the content fits.
 *
 * Both directions matter and the shrinking one is the harder: the correction
 * has to be measured from the scroll the box had BEFORE the content shrank,
 * because a browser clamps the scroll into the smaller content first.
 */
function worstDrift(zone: Zone, direction: 1 | -1 = 1): number {
  const floor = zoomFloor(
    Math.max(
      zone.minScale ?? 0,
      minScaleToFill((s) => zone.fixed + zone.width(s), zone.viewport),
    ),
  );
  const anchor = zone.viewport * 0.4;
  const clamp = (scroll: number, scale: number) =>
    Math.max(0, Math.min(scroll, zone.fixed + zone.width(scale) - zone.viewport));
  const fraction = (scroll: number, scale: number) =>
    (scroll + anchor - zone.fixed) / zone.width(scale);

  let scale = direction === 1 ? floor : MAX_STAGE_ZOOM;
  // Start looking at the middle of the content, wherever the box allows it.
  let scroll = clamp(zone.width(scale) / 2 + zone.fixed - anchor, scale);
  let worst = 0;
  for (let step = 0; step < 64; step += 1) {
    const next = stepZoom(scale, direction, floor);
    if (next === scale) break;
    const before = fraction(scroll, scale);
    const wanted = scrollAfterZoom({ left: scroll, top: 0 }, { x: anchor, y: 0 }, scale, next, {
      fixed: { x: zone.fixed },
      grew: { x: growthRatio(zone.width(scale), zone.width(next), next / scale) },
    }).left;
    const held = wanted === clamp(wanted, next);
    scroll = clamp(wanted, next);
    scale = next;
    // Only steps the box HAD the room for are the correction's to answer for.
    // Approaching the floor the content is barely wider than the box, so a few
    // pixels of scroll is all there is and the anchor cannot be honoured — by
    // then the whole zone is on screen, which is the point of stopping there.
    if (held) worst = Math.max(worst, Math.abs(fraction(scroll, scale) - before));
  }
  return worst;
}

describe('the stage ruler holds its day', () => {
  it('on a trip the box can fit, from 100% up', () => {
    // 100 days in a 900px box: 9px a day, strictly proportional.
    const drift = worstDrift({
      width: (s) => rulerTrackWidth(900, 100, s),
      fixed: 0,
      viewport: 900,
      minScale: 1,
    });
    expect(drift).toBeLessThan(0.0005);
  });

  it('on a trip too long for the box, where a day sits at its 6px floor', () => {
    // 616 days in a 460px box. This is the case that drifted: the track used
    // to be frozen at 3696px from 25% to 800% while the scroll was pulled by
    // a quarter at every notch.
    const ruler: Zone = {
      width: (s) => rulerTrackWidth(460, 616, s),
      fixed: 0,
      viewport: 460,
      minScale: 1,
    };
    expect(worstDrift(ruler, 1)).toBeLessThan(0.0005);
    expect(worstDrift(ruler, -1)).toBeLessThan(0.0005);
  });
});

describe('the day grid holds its day', () => {
  it('on a long trip, cell rounding and all', () => {
    const grid: Zone = {
      width: (s) => heatmapWidth(89, s), // ~620 days
      fixed: HEATMAP_FIXED.x,
      viewport: 460,
    };
    // A cell is a whole number of pixels, so a notch can be off by up to half
    // a pixel in a column — a thousandth of the grid, not a slide across it.
    expect(worstDrift(grid, 1)).toBeLessThan(0.002);
    expect(worstDrift(grid, -1)).toBeLessThan(0.002);
  });

  it('on a phone, where the floor is what makes the grid fill the box', () => {
    const drift = worstDrift({
      width: (s) => heatmapWidth(45, s),
      fixed: HEATMAP_FIXED.x,
      viewport: 390,
    });
    expect(drift).toBeLessThan(0.002);
  });
});
