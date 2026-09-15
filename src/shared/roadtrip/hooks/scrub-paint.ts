/**
 * Painting the scrub — one frame of «&nbsp;Défilé&nbsp;», read off the plan.
 *
 * Everything drawn here is a reading of `ScrubPlan` at `t`, so the tape, the
 * flash and the shutter dip agree with each other and with the numeral the
 * badge steps above them. Painted between the picture and the shades (the
 * engine's seam), so the badge always sits on top.
 *
 * What a frame shows, while the sweep runs:
 *
 * - a stop with a picture → that picture, cover-cropped into the frame (the
 *   source picture of the piece telling that day, or one the author picked);
 * - a stop without one, or whose picture could not be found → the frame goes
 *   dark. It is not a stand-in and it is not the hero shown early: an empty
 *   day looks empty, which is the honest reading of the calendar and what
 *   makes the hero's arrival land.
 *
 * Once the sweep has come to rest this draws nothing but the tape, and the
 * piece's own picture — already on the canvas — is the frame.
 *
 * Sizes are in units of a 1080-wide frame, so the stage preview and a 1080×1920
 * export draw the same tape at two scales.
 */

import { drawFramed } from '../../media/framing';
import type { FrameBox, HookCtx2D, HookPicture } from './hook-variant';
import {
  edgeFadeAt,
  hexToRgba,
  tapeFraction,
  tapeGeometry,
  tapeTicks,
  type ScrubOptions,
  type ScrubPlan,
} from './scrub-plan';

/** What an untold day looks like: the paper's ink, not pure black. */
const EMPTY_DAY = '#0c0b09';
/** How long the shutter dip lasts after the head lands, in seconds. */
const DIP_SECONDS = 0.06;
/** How dark the dip gets at its deepest. */
const DIP_ALPHA = 0.38;

export function paintScrub(
  g: HookCtx2D,
  plan: ScrubPlan,
  opts: ScrubOptions,
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  t: number,
  frame: FrameBox,
): void {
  const { width: w, height: h } = frame;
  if (w <= 0 || h <= 0) return;

  const sweeping = plan.sweepSeconds > 0 && t < plan.endSeconds;
  const index = plan.stopAt(t);

  if (opts.flash && sweeping) {
    const stop = plan.stops[index];
    const picture = stop.pictureKey ? pictures?.get(stop.pictureKey) : undefined;
    if (!drawPicture(g, picture, w, h)) {
      g.fillStyle = EMPTY_DAY;
      g.fillRect(0, 0, w, h);
    }
    // The projector's advance: a frame of darkness as the head lands. Not on
    // the first stop, which is where the sweep starts rather than a landing.
    const since = plan.sinceStopAt(t);
    if (index > 0 && since >= 0 && since < DIP_SECONDS) {
      g.save();
      g.globalAlpha = DIP_ALPHA * (1 - since / DIP_SECONDS);
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.restore();
    }
  }

  paintTape(g, plan, opts, t, w, h);
}

/**
 * Cover-crop a day's picture into the frame; false when there is none to
 * draw. A bitmap closed under a render still in flight throws on `drawImage` —
 * that frame then shows the day as empty rather than killing the paint loop.
 */
function drawPicture(
  g: HookCtx2D,
  picture: HookPicture | undefined,
  w: number,
  h: number,
): boolean {
  if (!picture || picture.width <= 0 || picture.height <= 0) return false;
  try {
    drawFramed(g, picture.image, picture.width, picture.height, w, h);
    return true;
  } catch {
    return false;
  }
}

function paintTape(
  g: HookCtx2D,
  plan: ScrubPlan,
  opts: ScrubOptions,
  t: number,
  w: number,
  h: number,
): void {
  // Every size and the band come from the pure geometry, so the rectangle the
  // stage grabs (`tapeBox`) is the one drawn here.
  const { x0, x1, length, baseline, dir, u, shortTick, headTall, tallTick, band } = tapeGeometry(w, h, opts);
  const headDay = plan.headDayAt(t);
  const legs = new Set(plan.legStarts);
  const xOf = (day: number) => x0 + length * tapeFraction(day, plan.totalDays);
  const fade = (x: number) => edgeFadeAt(x, x0, x1, opts.edgeFade);

  g.save();

  if (opts.tapeBackground) {
    // A dark band, rounded, faded at the ends with everything else when the
    // fade is on — a gradient fill rather than a mask, so no compositing mode
    // is involved (a shadow is dropped under `destination-*`, `studio.md`).
    const { x: bx, y: by, width: bw, height: bh } = band;
    if (opts.edgeFade) {
      const grad = g.createLinearGradient(bx, 0, bx + bw, 0);
      const stops = 12;
      for (let i = 0; i <= stops; i++) {
        const k = i / stops;
        grad.addColorStop(k, `rgba(0,0,0,${(opts.backgroundOpacity * fade(bx + bw * k)).toFixed(3)})`);
      }
      g.fillStyle = grad;
    } else {
      g.fillStyle = `rgba(0,0,0,${opts.backgroundOpacity})`;
    }
    roundedBar(g, bx, by, bw, bh, 8 * u);
  }

  if (opts.showTrack) {
    if (opts.edgeFade) {
      const grad = g.createLinearGradient(x0, 0, x1, 0);
      const stops = 12;
      for (let i = 0; i <= stops; i++) {
        const k = i / stops;
        grad.addColorStop(k, hexToRgba(opts.tickColor, opts.tickOpacity * fade(x0 + length * k)));
      }
      g.fillStyle = grad;
    } else {
      g.fillStyle = hexToRgba(opts.tickColor, opts.tickOpacity);
    }
    g.fillRect(x0, baseline - 0.75 * u, length, 1.5 * u);
  }

  for (const day of tapeTicks(plan.totalDays, length, plan.legStarts, opts.tickGap * u)) {
    const leg = legs.has(day);
    const tall = leg ? tallTick : shortTick;
    const passed = day <= headDay + 1e-6;
    const x = xOf(day);
    const alpha = fade(x) * (passed ? 0.95 : Math.min(1, opts.tickOpacity + (leg ? 0.25 : 0)));
    if (alpha <= 0) continue;
    g.fillStyle = hexToRgba(passed ? opts.passedColor : opts.tickColor, alpha);
    g.fillRect(x - u, dir < 0 ? baseline - tall : baseline, 2 * u, tall);
  }

  // The reading head. Its glow is one shadow blur a frame — affordable on a
  // single small shape where it is not on every tick.
  const hx = x0 + length * tapeFraction(headDay, plan.totalDays);
  g.globalAlpha = fade(hx);
  if (opts.headGlow) {
    g.shadowColor = hexToRgba(opts.passedColor, 0.75);
    g.shadowBlur = 14 * u;
  }
  g.fillStyle = hexToRgba(opts.passedColor, 1);
  if (opts.headStyle === 'dot') {
    const cy = dir < 0 ? baseline - shortTick - 9 * u : baseline + shortTick + 9 * u;
    g.beginPath();
    g.arc(hx, cy, 7 * u, 0, Math.PI * 2);
    g.fill();
  } else if (opts.headStyle === 'needle') {
    // A triangle pointing AT the tape from beyond the tallest tick.
    const base = dir < 0 ? baseline - headTall : baseline + headTall;
    const tip = dir < 0 ? baseline - 4 * u : baseline + 4 * u;
    g.beginPath();
    g.moveTo(hx, tip);
    g.lineTo(hx - 7 * u, base);
    g.lineTo(hx + 7 * u, base);
    g.closePath();
    g.fill();
  } else {
    roundedBar(
      g,
      hx - 2.5 * u,
      dir < 0 ? baseline - headTall + 6 * u : baseline - 6 * u,
      5 * u,
      headTall,
      2.5 * u,
    );
  }

  g.restore();
}

function roundedBar(g: HookCtx2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
  g.fill();
}
