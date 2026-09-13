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
 * - a TOLD day → that day's picture, cover-cropped into the frame;
 * - a day nothing was told from → the frame goes dark. It is not a stand-in
 *   and it is not the hero shown early: an empty day looks empty, which is the
 *   honest reading of the calendar and what makes the hero's arrival land.
 *
 * Once the sweep has come to rest this draws nothing but the tape, and the
 * piece's own picture — already on the canvas — is the frame.
 *
 * Sizes are in units of a 1080-wide frame, so the stage preview and a 1080×1920
 * export draw the same tape at two scales.
 */

import { drawFramed } from '../../media/framing';
import type { FrameBox, HookCtx2D, HookPicture } from './hook-variant';
import { tapeFraction, tapeTicks, type ScrubOptions, type ScrubPlan } from './scrub-plan';

/** The suite's vermilion — the reading head and every day it has passed. */
const ACCENT = '#d9442a';
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
    const picture = stop.told ? pictures?.get(stop.date) : undefined;
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
  const u = w / 1080;
  const x0 = w * 0.07;
  const x1 = w * 0.93;
  const length = x1 - x0;
  const top = opts.tape === 'top';
  const baseline = top ? h * 0.045 : h * 0.955;
  // Ticks grow AWAY from the frame's edge, into the picture.
  const dir = top ? 1 : -1;
  const headDay = plan.headDayAt(t);
  const legs = new Set(plan.legStarts);
  const xOf = (day: number) => x0 + length * tapeFraction(day, plan.totalDays);

  g.save();

  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(x0, baseline - 0.75 * u, length, 1.5 * u);

  for (const day of tapeTicks(plan.totalDays, length, plan.legStarts, 6 * u)) {
    const leg = legs.has(day);
    const tall = (leg ? 26 : 13) * u;
    const passed = day <= headDay + 1e-6;
    g.fillStyle = passed ? ACCENT : leg ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)';
    const x = xOf(day) - u;
    g.fillRect(x, dir < 0 ? baseline - tall : baseline, 2 * u, tall);
  }

  // The reading head, with a glow — one small shape a frame, so the shadow
  // blur is affordable here where it is not on every tick.
  const hx = x0 + length * tapeFraction(headDay, plan.totalDays);
  const headTall = 40 * u;
  g.shadowColor = 'rgba(217,68,42,0.75)';
  g.shadowBlur = 14 * u;
  g.fillStyle = ACCENT;
  roundedBar(g, hx - 2.5 * u, dir < 0 ? baseline - headTall + 6 * u : baseline - 6 * u, 5 * u, headTall, 2.5 * u);

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
