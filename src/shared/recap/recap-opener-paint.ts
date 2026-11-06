/**
 * Painting a recap's OPENER, and the film with it: `paintFilm` is what the
 * stage and the Reel call — the opener while its seconds run, the recap's own
 * pages after (`paintRecap`), one clock for both.
 *
 * - Défilé: the stop's picture full page (its own frame), the projector's dip
 *   as the head lands, Trips' tape (`paintTape`) and the day under the head.
 * - Badge: the picture pushed in, a shade, the block of its day, its place and
 *   its camera in the recap's own faces.
 * - A trip opener paints itself (`TripOpenerPlan.paint`).
 *
 * DOM-free: a recording context checks it in node.
 */

import { SCRUB_DEFAULTS, tapeGeometry } from '../roadtrip/hooks/scrub-plan';
import { paintTape } from '../roadtrip/hooks/scrub-paint';
import type { RecapDoc, RecapPicture } from './recap-doc';
import { insets, type RecapLayout } from './recap-layout';
import type { FilmPlan } from './recap-motion';
import { badgeLook, type BadgePlan, type DefilePlan, type OpenerPlan } from './recap-opener-plan';
import { FACES, MONO, ON_MEDIA, drawCover, paintRecap, sizeIn, styled, type Ctx2D, type PaintOptions, type PaintSources } from './recap-paint';
import { shortDate } from './recap-days';
import type { ResolvedRecap } from './recap-slots';

/** An empty stop, as Trips draws one: the paper's ink, not pure black. */
const EMPTY = '#0c0b09';
const DIP_SECONDS = 0.06;
const DIP_ALPHA = 0.38;

/** True while the film's time `t` is the opener's. */
export const inOpener = (film: FilmPlan, t: number) => Boolean(film.opener) && t < (film.lead ?? 0);

/**
 * The film at `opts.t`: the opener while it runs, else the recap's page — what
 * every painter of the MOVING film calls (the stage, the Reel).
 */
export function paintFilm(g: Ctx2D, width: number, doc: RecapDoc, resolved: ResolvedRecap, layout: RecapLayout, film: FilmPlan, src: PaintSources, opts: PaintOptions): void {
  if (film.opener && inOpener(film, opts.t)) paintOpener(g, width, doc, layout, film.opener, src, opts.t);
  else paintRecap(g, width, doc, resolved, layout, film, src, opts);
}

/** The opener's frame at its own time `t`, at the context's width (the page's shape). */
export function paintOpener(g: Ctx2D, width: number, doc: RecapDoc, layout: RecapLayout, plan: OpenerPlan, src: PaintSources, t: number): void {
  const page = layout.pages[0];
  if (!page) return;
  const W = page.width;
  const H = page.height;
  const k = width / W;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.save();
  g.setTransform(k, 0, 0, k, 0, 0);
  g.beginPath();
  g.rect(0, 0, W, H);
  g.clip();
  const byKey = new Map(doc.pictures.map((p) => [p.key, p]));
  if (plan.kind === 'defile') paintDefile(g, doc, plan, byKey, src, t, W, H);
  else if (plan.kind === 'badge') paintBadge(g, doc, plan, byKey, src, t, W, H);
  else plan.paint(g, W, H, t, (k) => src.still(k));
  g.restore();
}

/** A still drawn over the whole page at its own frame (zoomed `zoom` times more); false when it is not in hand. */
function fullPage(g: Ctx2D, p: RecapPicture | undefined, src: PaintSources, W: number, H: number, zoom = 1): boolean {
  if (!p) return false;
  const still = src.still(p.key);
  if (!still) return false;
  const f = p.frame ?? { x: 0.5, y: 0.5, zoom: 1 };
  try {
    drawCover(g, still, { x: 0, y: 0, w: W, h: H }, { ...f, zoom: Math.min(4, f.zoom * zoom) });
    return true;
  } catch {
    return false;
  }
}

function paintDefile(g: Ctx2D, doc: RecapDoc, plan: DefilePlan, byKey: Map<string, RecapPicture>, src: PaintSources, t: number, W: number, H: number): void {
  const index = plan.stopAt(t);
  const stop = plan.stops[index];
  const picture = byKey.get(stop.key);
  if (!fullPage(g, picture, src, W, H)) {
    g.fillStyle = EMPTY;
    g.fillRect(0, 0, W, H);
  }
  // The projector's advance: a frame of darkness as the head lands (never on the first, where the sweep starts).
  const since = plan.sinceStopAt(t);
  if (index > 0 && since >= 0 && since < DIP_SECONDS) {
    g.fillStyle = `rgba(0,0,0,${DIP_ALPHA * (1 - since / DIP_SECONDS)})`;
    g.fillRect(0, 0, W, H);
  }
  if (!plan.tape) return;
  // Above a Reel's buttons, as every other part of the page.
  const { bottom } = insets(doc.format, H);
  const geo = tapeGeometry(W, H, { tape: 'bottom', tapeWidth: SCRUB_DEFAULTS.tapeWidth, edgeOffset: Math.min(0.2, bottom / H + 0.02) });
  paintTape(g, { totalDays: plan.totalDays, legStarts: [], headDay: plan.headDayAt(t) }, SCRUB_DEFAULTS, geo);
  // The day the picture was taken, above the tape's start.
  if (picture?.day) {
    const size = W * 0.028;
    styled(g, doc, 'labels', shortDate(picture.day), geo.x0, geo.baseline - geo.headTall - size * 0.9, size, { face: MONO, colour: ON_MEDIA, spacing: 0.08, upper: true, shadow: true });
  }
}

function paintBadge(g: Ctx2D, doc: RecapDoc, plan: BadgePlan, byKey: Map<string, RecapPicture>, src: PaintSources, t: number, W: number, H: number): void {
  const look = badgeLook(plan, t);
  if (!fullPage(g, plan.key ? byKey.get(plan.key) : undefined, src, W, H, look.zoom)) {
    g.fillStyle = EMPTY;
    g.fillRect(0, 0, W, H);
  }
  const { bottom } = insets(doc.format, H);
  // A shade from the bottom, so the block reads over any picture.
  const shade = g.createLinearGradient(0, H * 0.45, 0, H);
  shade.addColorStop(0, 'rgba(10,8,6,0)');
  shade.addColorStop(1, `rgba(10,8,6,${0.62 * look.block})`);
  g.fillStyle = shade;
  g.fillRect(0, H * 0.45, W, H * 0.55);
  if (look.block <= 0) return;
  const m = Math.round(W * 0.08);
  const maxWidth = W - 2 * m;
  const rise = (1 - look.block) * H * 0.025;
  g.save();
  g.globalAlpha = look.block;
  const titleSize = W * (doc.font === 'serif' ? 0.1 : doc.font === 'mono' ? 0.056 : 0.07);
  const small = W * 0.03;
  let y = H - bottom - m * 0.4 + rise;
  if (plan.camera) {
    styled(g, doc, 'labels', plan.camera, m, y, small, { face: MONO, colour: ON_MEDIA, spacing: 0.04, shadow: true, maxWidth });
    y -= sizeIn(doc, 'labels', small) * 1.9;
  }
  if (plan.title) {
    styled(g, doc, 'heading', plan.title, m, y, titleSize, { face: FACES[doc.font], colour: ON_MEDIA, upper: doc.font === 'sans', spacing: doc.font === 'sans' ? 0.04 : 0, shadow: true, maxWidth });
    y -= sizeIn(doc, 'heading', titleSize) * 1.05;
  }
  if (plan.date) styled(g, doc, 'labels', plan.date, m, y, small, { face: MONO, colour: ON_MEDIA, spacing: 0.12, shadow: true, maxWidth });
  g.restore();
}
