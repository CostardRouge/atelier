/**
 * Painting the recap's SUMMARY CARD (`summary-card.ts`): five faces that
 * cover the frame — the trace, the ticket, the passport, the contact sheet
 * and the dashboard — on the trip's last picture veiled, the look's own solid
 * or the map's paper. (The sixth, the stamp in the map's box, is the drive's
 * own `paintSummary`.)
 *
 * Every word goes through the overlay engine in the card's look
 * (`look-text.ts`); the shapes are inked with the look's colour. Sizes are in
 * units of the frame's SHORT side over 1080, so a 9:16 reel and a 4:5 post
 * draw the same card, laid out for their height. What is drawn at a moment
 * is a function of the time since the card came (`since`): it fades up, its
 * numbers count up and its road draws itself on `count`; on `cut` it is
 * whole at once.
 */

import { hexToRgba } from './colour';
import { planBounds, type DrivePlan, type PlanPoint } from './drive-plan';
import type { FrameBox, HookCtx2D, HookPicture } from './hook-variant';
import { drawLookTexts, fitLookText, measureLookText, type LookText } from './look-text';
import { cellAt, cityCode, labelText, type CardOptions, type CardScene } from './summary-card';
import { MAX_STAMPS } from './passport-stamps';

/** The card's fade up, and the numbers' and the road's count, in seconds. */
export const CARD_RISE_SECONDS = 0.45;
export const CARD_COUNT_SECONDS = 1.4;
const COUNT_DELAY = 0.15;

/** The card at `since` seconds after it came: its opacity and how far its numbers have counted. */
export function cardProgress(entrance: CardOptions['cardEntrance'], since: number): { alpha: number; count: number } {
  if (entrance === 'cut') return { alpha: since >= 0 ? 1 : 0, count: 1 };
  const alpha = Math.max(0, Math.min(1, since / CARD_RISE_SECONDS));
  const count = Math.max(0, Math.min(1, (since - COUNT_DELAY) / CARD_COUNT_SECONDS));
  return { alpha: 1 - Math.pow(1 - alpha, 3), count };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What every face shares while it paints. */
interface Pen {
  g: HookCtx2D;
  s: CardScene;
  w: number;
  h: number;
  /** One unit of a 1080 short side. */
  u: number;
  alpha: number;
  count: number;
  t: number;
  texts: LookText[];
}

export function paintCard(
  g: HookCtx2D,
  scene: CardScene,
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  since: number,
  frame: FrameBox,
  t: number,
): void {
  const { width: w, height: h } = frame;
  const { alpha, count } = cardProgress(scene.card.cardEntrance, since);
  if (alpha <= 0) return;
  const pen: Pen = { g, s: scene, w, h, u: Math.min(w, h) / 1080, alpha, count, t, texts: [] };
  g.save();
  g.globalAlpha = alpha;
  paintGround(pen, pictures);
  g.restore();
  if (scene.face === 'stamp') paintStamp(pen);
  else if (scene.face === 'trace') paintTrace(pen);
  else if (scene.face === 'ticket') paintTicket(pen);
  else if (scene.face === 'passport') paintPassport(pen);
  else if (scene.face === 'sheet') paintSheet(pen, pictures);
  else paintDash(pen);
  drawLookTexts(g, pen.texts, w, h, scene.theme, t);
}

// --- the ground --------------------------------------------------------------------

function paintGround(pen: Pen, pictures: ReadonlyMap<string, HookPicture> | undefined): void {
  const { g, s, w, h, u } = pen;
  const photo = s.card.cardGround === 'photo';
  const picture = photo && s.groundPicture ? pictures?.get(s.groundPicture) : undefined;
  // The slide's own picture is already under a card that stands alone.
  const under = photo && !picture && s.below;
  if (!under) {
    g.fillStyle = s.ink.ground;
    g.fillRect(0, 0, w, h);
  }
  if (picture || under) {
    if (picture) coverImage(g, picture, { x: 0, y: 0, w, h });
    // The veil: the picture stays a picture, the words read over it.
    g.fillStyle = 'rgba(8,7,6,0.5)';
    g.fillRect(0, 0, w, h);
    const fade = g.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(8,7,6,0.55)');
    fade.addColorStop(0.35, 'rgba(8,7,6,0)');
    fade.addColorStop(0.65, 'rgba(8,7,6,0)');
    fade.addColorStop(1, 'rgba(8,7,6,0.6)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
    return;
  }
  if (s.ink.texture === 'grain') {
    // A warm black's grain: fixed specks, the same on every frame.
    g.fillStyle = 'rgba(255,236,200,0.05)';
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round((w * h) / (900 * u * u));
    for (let i = 0; i < n; i++) g.fillRect(rnd() * w, rnd() * h, 1.6 * u, 1.6 * u);
  } else if (s.ink.texture === 'scan') {
    g.fillStyle = hexToRgba(s.ink.accent, 0.06);
    for (let y = 0; y < h; y += 4 * u) g.fillRect(0, y, w, 1.4 * u);
  }
}

function coverImage(g: HookCtx2D, picture: HookPicture, box: Box): void {
  const { image, width: sw, height: sh } = picture;
  if (!(sw > 0 && sh > 0)) return;
  const k = Math.max(box.w / sw, box.h / sh);
  const cw = box.w / k;
  const ch = box.h / k;
  g.drawImage(image, (sw - cw) / 2, (sh - ch) / 2, cw, ch, box.x, box.y, box.w, box.h);
}

// --- the shared pieces ---------------------------------------------------------------

/** A string in the card's look, its ink the ground's where the look's colour would not read. */
function say(pen: Pen, id: string, text: string, px: number, x: number, y: number, anchor: LookText['anchor'], soft = 1): void {
  if (!text) return;
  const ink = pen.s.ink.ink;
  pen.texts.push({
    id: `card:${id}`,
    text,
    px,
    x,
    y,
    anchor,
    alpha: pen.alpha * soft,
    ...(ink ? { ink: soft < 1 ? hexToRgba(ink, soft) : ink } : soft < 1 ? { plain: true } : {}),
  });
}

/** The title and the subtitle at the top of a box; returns where they end. */
function titleBlock(pen: Pen, box: Box, align: 'center' | 'left' = 'center', scale = 1): number {
  const { g, s, w, h, u } = pen;
  const x = align === 'center' ? box.x + box.w / 2 : box.x;
  const anchor = align === 'center' ? 'top-center' : 'top-left';
  const px = fitLookText(g, { id: 'card:title', text: s.title, px: 92 * u * scale, ...(s.ink.ink ? { ink: s.ink.ink } : {}) }, box.w, w, h, s.theme);
  say(pen, 'title', s.title, px, x, box.y, anchor);
  const titleH = measureLookText(g, { id: 'card:title', text: s.title || 'X', px }, w, h, s.theme).h;
  const subY = box.y + titleH + 22 * u * scale;
  say(pen, 'subtitle', s.subtitle, 34 * u * scale, x, subY, anchor, 0.78);
  return subY + 44 * u * scale;
}

/** The facts in a row, each a number over its word, split by faint rules. */
function factsRow(pen: Pen, box: Box, valuePx = 86, wordPx = 26): void {
  const { g, s, u } = pen;
  const cells = s.cells;
  if (!cells.length) return;
  const cw = box.w / cells.length;
  cells.forEach((cell, i) => {
    const cx = box.x + cw * (i + 0.5);
    say(pen, `fact:${i}`, cellAt(cell, pen.count, s.unit), valuePx * u, cx, box.y + valuePx * u, 'bottom-center');
    say(pen, `word:${i}`, cell.word, wordPx * u, cx, box.y + valuePx * u + 16 * u, 'top-center', 0.72);
    if (i > 0) {
      g.save();
      g.globalAlpha = pen.alpha * 0.3;
      g.strokeStyle = s.ink.rule;
      g.lineWidth = 1.5 * u;
      g.beginPath();
      g.moveTo(box.x + cw * i, box.y + 10 * u);
      g.lineTo(box.x + cw * i, box.y + valuePx * u + 44 * u);
      g.stroke();
      g.restore();
    }
  });
}

/** How tall `factsRow` is at these sizes. */
function factsHeight(u: number, valuePx = 86, wordPx = 26): number {
  return (valuePx + 16 + wordPx + 14) * u;
}

/** The road fitted into a box, preserving its shape. */
function fitRoad(plan: DrivePlan, box: Box): (p: PlanPoint) => { x: number; y: number } {
  const b = planBounds(plan);
  const bw = Math.max(1e-6, b.x1 - b.x0);
  const bh = Math.max(1e-6, b.y1 - b.y0);
  const k = Math.min(box.w / bw, box.h / bh);
  const ox = box.x + (box.w - bw * k) / 2;
  const oy = box.y + (box.h - bh * k) / 2;
  return (p) => ({ x: ox + (p.x - b.x0) * k, y: oy + (p.y - b.y0) * k });
}

/** The road drawn up to `upTo` (0..1 of its length), with its stops, in the look's colour. */
function drawRoad(pen: Pen, plan: DrivePlan, at: (p: PlanPoint) => { x: number; y: number }, upTo: number, width: number, dots: boolean): void {
  const { g, s, u } = pen;
  const { points, cum, length } = plan.path;
  const limit = length * Math.max(0, Math.min(1, upTo));
  g.save();
  g.globalAlpha = pen.alpha;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const trace = () => {
    g.beginPath();
    let started = false;
    for (let i = 0; i < points.length; i++) {
      if (cum[i] > limit + 1e-9) {
        if (i > 0 && cum[i] > cum[i - 1]) {
          const f = (limit - cum[i - 1]) / (cum[i] - cum[i - 1]);
          const a = at(points[i - 1]);
          const b = at(points[i]);
          g.lineTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        }
        break;
      }
      const p = at(points[i]);
      if (started) g.lineTo(p.x, p.y);
      else g.moveTo(p.x, p.y);
      started = true;
    }
  };
  // A soft dark bed under the line, so it reads over a picture.
  if (s.card.cardGround !== 'paper') {
    trace();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = width * 2.6;
    g.stroke();
  }
  trace();
  g.strokeStyle = s.ink.accent;
  g.lineWidth = width;
  g.stroke();
  if (dots) {
    const n = plan.route.stops.length;
    plan.path.stopS.forEach((sAt, i) => {
      if (sAt > limit + 1e-6) return;
      const p = at(plan.points[i]);
      const end = i === 0 || i === n - 1;
      g.beginPath();
      g.arc(p.x, p.y, (end ? 9 : 5) * u, 0, Math.PI * 2);
      g.fillStyle = end ? s.ink.ground : s.ink.accent;
      g.fill();
      if (end) {
        g.lineWidth = 4 * u;
        g.strokeStyle = s.ink.accent;
        g.stroke();
      }
    });
  }
  g.restore();
}

/**
 * The places' names beside their dots, the ends first then the bigger groups;
 * a name that would cover another, or a zone kept clear, is skipped.
 */
function placeLabels(pen: Pen, at: (p: PlanPoint) => { x: number; y: number }, keepClear: Box[], within: Box, px: number): void {
  const { g, s, w, h, u } = pen;
  const placed: Box[] = [...keepClear];
  const order = [...s.labels].sort((a, b) => a.rank - b.rank);
  const pad = 4 * u;
  for (const label of order) {
    const sAt = s.plan.path.stopS[label.stop] ?? 0;
    if (sAt > s.plan.path.length * pen.count + 1e-6) continue;
    const text = labelText(label);
    const size = measureLookText(g, { id: `card:label:${label.stop}`, text, px }, w, h, s.theme);
    const p = at(s.plan.points[label.stop]);
    const gap = 14 * u;
    const tries: { box: Box; x: number; y: number; anchor: LookText['anchor'] }[] = [
      { box: { x: p.x + gap, y: p.y - size.h / 2, w: size.w, h: size.h }, x: p.x + gap, y: p.y, anchor: 'center-left' },
      { box: { x: p.x - gap - size.w, y: p.y - size.h / 2, w: size.w, h: size.h }, x: p.x - gap, y: p.y, anchor: 'center-right' },
      { box: { x: p.x - size.w / 2, y: p.y - gap - size.h, w: size.w, h: size.h }, x: p.x, y: p.y - gap, anchor: 'bottom-center' },
      { box: { x: p.x - size.w / 2, y: p.y + gap, w: size.w, h: size.h }, x: p.x, y: p.y + gap, anchor: 'top-center' },
    ];
    const fits = tries.find(
      (c) =>
        c.box.x >= within.x &&
        c.box.x + c.box.w <= within.x + within.w &&
        c.box.y >= within.y &&
        c.box.y + c.box.h <= within.y + within.h &&
        !placed.some((o) => overlaps(o, c.box, pad)),
    );
    if (!fits) continue;
    placed.push(fits.box);
    say(pen, `label:${label.stop}`, text, px, fits.x, fits.y, fits.anchor, 0.92);
  }
}

function overlaps(a: Box, b: Box, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function frameBox(pen: Pen): Box {
  const pad = 80 * pen.u;
  return { x: pad, y: pad, w: pen.w - pad * 2, h: pen.h - pad * 2 };
}

// --- the TRACE ---------------------------------------------------------------------

function paintTrace(pen: Pen): void {
  const { s, u } = pen;
  const box = frameBox(pen);
  const titleEnd = titleBlock(pen, box);
  const fh = factsHeight(u);
  const factsY = box.y + box.h - fh;
  factsRow(pen, { x: box.x, y: factsY, w: box.w, h: fh });
  const road: Box = { x: box.x + 40 * u, y: titleEnd + 40 * u, w: box.w - 80 * u, h: factsY - titleEnd - 100 * u };
  if (road.h <= 40 * u) return;
  const at = fitRoad(s.plan, road);
  drawRoad(pen, s.plan, at, pen.count, 7 * u, true);
  const within: Box = { x: 24 * u, y: titleEnd, w: pen.w - 48 * u, h: factsY - titleEnd - 16 * u };
  placeLabels(pen, at, [], within, 30 * u);
}

// --- the STAMP ----------------------------------------------------------------------

/**
 * The stamp as a picture of itself — the road under a box of facts. Virée
 * draws the real one in its map's box (`paintSummary`); this is what the
 * face picker shows of it.
 */
function paintStamp(pen: Pen): void {
  const { g, s, w, h, u } = pen;
  const at = fitRoad(s.plan, { x: w * 0.12, y: h * 0.12, w: w * 0.76, h: h * 0.76 });
  g.save();
  g.globalAlpha = 0.55;
  drawRoad({ ...pen, alpha: pen.alpha * 0.55 }, s.plan, at, 1, 5 * u, true);
  g.restore();
  const bw = Math.min(w * 0.86, 640 * u);
  const bh = 190 * u;
  const box: Box = { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh };
  g.save();
  g.globalAlpha = pen.alpha;
  g.beginPath();
  roundRectOn(g, box.x, box.y, box.w, box.h, 16 * u);
  g.fillStyle = s.ink.ground;
  g.fill();
  g.lineWidth = 2 * u;
  g.strokeStyle = hexToRgba(s.ink.rule, 0.3);
  g.stroke();
  g.restore();
  factsRow(pen, { x: box.x, y: box.y + 30 * u, w: box.w, h: bh - 40 * u }, 64, 22);
}

// --- the TICKET ----------------------------------------------------------------------

function paintTicket(pen: Pen): void {
  const { g, s, w, h, u } = pen;
  const outer = frameBox(pen);
  const tw = Math.min(outer.w, 920 * u);
  const th = Math.min(outer.h, 1180 * u);
  const box: Box = { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
  const stub = box.y + th * 0.74;
  const notch = 34 * u;
  // The ticket: a panel with a notch either side of its tear line.
  g.save();
  g.globalAlpha = pen.alpha;
  const body = ticketPath(box, 28 * u, stub, notch);
  g.fillStyle = panelFill(s);
  g.fill(body);
  g.lineWidth = 2 * u;
  g.strokeStyle = hexToRgba(s.ink.rule, 0.35);
  g.stroke(body);
  // The tear line.
  g.setLineDash([10 * u, 10 * u]);
  g.beginPath();
  g.moveTo(box.x + notch + 12 * u, stub);
  g.lineTo(box.x + box.w - notch - 12 * u, stub);
  g.stroke();
  g.setLineDash([]);
  g.restore();

  const inner: Box = { x: box.x + 60 * u, y: box.y + 64 * u, w: box.w - 120 * u, h: box.h - 128 * u };
  // The trip, as the passenger's name.
  say(pen, 'kicker', 'BOARDING PASS', 26 * u, inner.x, inner.y, 'top-left', 0.7);
  const titlePx = fitLookText(g, { id: 'card:title', text: s.title, px: 64 * u }, inner.w, w, h, s.theme);
  say(pen, 'title', s.title, titlePx, inner.x, inner.y + 48 * u, 'top-left');
  // From → to: the codes, big, the names under them.
  const codesY = inner.y + 300 * u;
  const from = cityCode(s.facts.first, s.card.cardFrom);
  const to = cityCode(s.facts.last, s.card.cardTo);
  say(pen, 'from', from, 150 * u, inner.x, codesY, 'bottom-left');
  say(pen, 'to', to, 150 * u, inner.x + inner.w, codesY, 'bottom-right');
  say(pen, 'arrow', '→', 90 * u, inner.x + inner.w / 2, codesY - 20 * u, 'bottom-center', 0.8);
  say(pen, 'from-name', s.facts.first, 28 * u, inner.x, codesY + 18 * u, 'top-left', 0.75);
  say(pen, 'to-name', s.facts.last, 28 * u, inner.x + inner.w, codesY + 18 * u, 'top-right', 0.75);
  // The dates.
  const datesY = codesY + 110 * u;
  if (s.from) {
    say(pen, 'date-label', 'DEPARTED', 22 * u, inner.x, datesY, 'top-left', 0.6);
    say(pen, 'date-from', s.from, 36 * u, inner.x, datesY + 34 * u, 'top-left');
  }
  if (s.to) {
    say(pen, 'date-label-2', 'ARRIVED', 22 * u, inner.x + inner.w, datesY, 'top-right', 0.6);
    say(pen, 'date-to', s.to, 36 * u, inner.x + inner.w, datesY + 34 * u, 'top-right');
  }
  // The facts, small, above the tear.
  const fh = factsHeight(u, 64, 22);
  factsRow(pen, { x: inner.x, y: stub - fh - 40 * u, w: inner.w, h: fh }, 64, 22);
  // The barcode: the trip's days, one bar each.
  barcode(pen, { x: inner.x, y: stub + 60 * u, w: inner.w, h: box.y + box.h - stub - 110 * u });
}

function panelFill(s: CardScene): string {
  if (s.card.cardGround === 'paper') return hexToRgba(s.ink.ground, 1);
  if (s.card.cardGround === 'solid') return hexToRgba(s.ink.ink ? '#000000' : '#ffffff', s.ink.ink ? 0.12 : 0.06);
  return 'rgba(10,9,8,0.55)';
}

function barcode(pen: Pen, box: Box): void {
  const { g, s, u } = pen;
  const days = s.days;
  if (!days.length || box.h <= 0) return;
  const step = box.w / days.length;
  const bar = Math.max(1 * u, Math.min(step * 0.6, 8 * u));
  g.save();
  g.globalAlpha = pen.alpha;
  g.fillStyle = s.ink.ink ?? s.ink.accent;
  const shown = Math.ceil(days.length * pen.count);
  days.slice(0, shown).forEach((day, i) => {
    const x = box.x + step * (i + 0.5) - bar / 2;
    const tall = day.legStart ? box.h : box.h * 0.72;
    g.globalAlpha = pen.alpha * (day.photo ? 1 : 0.45);
    g.fillRect(x, box.y + (box.h - tall), bar, tall);
  });
  g.restore();
}

/** A ticket's outline: rounded corners, and a half-round notch bitten into each side at the tear line. */
function ticketPath(box: Box, r: number, tear: number, notch: number): Path2D {
  const { x, y, w, h } = box;
  const rr = Math.min(r, w / 2, h / 2);
  const p = new Path2D();
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, tear - notch);
  p.arc(x + w, tear, notch, -Math.PI / 2, Math.PI / 2, true);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, tear + notch);
  p.arc(x, tear, notch, Math.PI / 2, -Math.PI / 2, true);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  p.closePath();
  return p;
}

// --- the PASSPORT --------------------------------------------------------------------

function paintPassport(pen: Pen): void {
  const { g, s, w, h, u } = pen;
  const box = frameBox(pen);
  const titleEnd = titleBlock(pen, box, 'center', 0.9);
  const fh = factsHeight(u);
  const factsY = box.y + box.h - fh;
  factsRow(pen, { x: box.x, y: factsY, w: box.w, h: fh });
  // The stamps, in the road's order (`passport-stamps.ts`): a state where it
  // is known, else the place; past a page's worth, the rest are counted.
  const marks = s.stamps.slice(0, MAX_STAMPS);
  const more = s.stamps.length - marks.length;
  if (!marks.length) return;
  const area: Box = { x: box.x, y: titleEnd + 30 * u, w: box.w, h: factsY - titleEnd - 80 * u };
  const cols = marks.length <= 2 ? marks.length : marks.length <= 4 ? 2 : 3;
  const rows = Math.ceil(marks.length / cols);
  const cell = Math.min(area.w / cols, area.h / rows);
  const r = cell * 0.4;
  const shown = Math.ceil(marks.length * Math.max(pen.count, pen.s.card.cardEntrance === 'cut' ? 1 : 0));
  marks.forEach((mark, i) => {
    if (i >= shown) return;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rowCount = Math.min(cols, marks.length - row * cols);
    const cx = area.x + (area.w - rowCount * cell) / 2 + cell * (col + 0.5);
    const cy = area.y + (area.h - rows * cell) / 2 + cell * (row + 0.5);
    const tilt = ((i * 37) % 17 - 8) * (Math.PI / 180);
    // The shape says the level: a state's round stamp, a place's rectangle.
    const round = mark.kind === 'state';
    g.save();
    g.globalAlpha = pen.alpha * 0.9;
    g.translate(cx, cy);
    g.rotate(tilt);
    g.strokeStyle = s.ink.accent;
    g.lineWidth = 5 * u;
    g.beginPath();
    if (round) g.arc(0, 0, r, 0, Math.PI * 2);
    else roundRectOn(g, -r * 1.05, -r * 0.8, r * 2.1, r * 1.6, 14 * u);
    g.stroke();
    g.lineWidth = 2 * u;
    g.beginPath();
    if (round) g.arc(0, 0, r * 0.84, 0, Math.PI * 2);
    else roundRectOn(g, -r * 0.92, -r * 0.67, r * 1.84, r * 1.34, 10 * u);
    g.stroke();
    g.restore();
    const big = fitLookText(g, { id: `card:stamp:${i}`, text: mark.big, px: r * 0.62 }, r * 1.5, w, h, s.theme);
    say(pen, `stamp:${i}`, mark.big, big, cx, cy, 'center');
    if (mark.small) say(pen, `stamp-name:${i}`, mark.small, 20 * u, cx, cy + r + 18 * u, 'top-center', 0.7);
  });
  if (more > 0 && shown >= marks.length) say(pen, 'stamp-more', `+${more}`, 34 * u, area.x + area.w, area.y + area.h, 'bottom-right', 0.8);
}

function roundRectOn(g: HookCtx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

// --- the contact SHEET ---------------------------------------------------------------

function paintSheet(pen: Pen, pictures: ReadonlyMap<string, HookPicture> | undefined): void {
  const { g, s, u } = pen;
  const box = frameBox(pen);
  const titleEnd = titleBlock(pen, box, 'left', 0.85);
  const fh = factsHeight(u, 70, 24);
  const factsY = box.y + box.h - fh;
  factsRow(pen, { x: box.x, y: factsY, w: box.w, h: fh }, 70, 24);
  const shown = s.sheet.map((key) => pictures?.get(key)).filter((p): p is HookPicture => !!p);
  const area: Box = { x: box.x, y: titleEnd + 20 * u, w: box.w, h: factsY - titleEnd - 60 * u };
  if (!shown.length) {
    // Nothing to print: the road alone.
    const at = fitRoad(s.plan, { x: area.x + 40 * u, y: area.y + 40 * u, w: area.w - 80 * u, h: area.h - 80 * u });
    drawRoad(pen, s.plan, at, pen.count, 7 * u, true);
    return;
  }
  // The road in the last cell, the pictures before it — three across.
  const cells = Math.min(shown.length, 8) + 1;
  const cols = 3;
  const rows = Math.ceil(cells / cols);
  const gap = 14 * u;
  const cw = (area.w - gap * (cols - 1)) / cols;
  const ch = Math.min(cw * 1.25, (area.h - gap * (rows - 1)) / rows);
  const top = area.y + (area.h - (ch * rows + gap * (rows - 1))) / 2;
  const reveal = Math.ceil(cells * Math.max(0.0001, pen.count));
  for (let i = 0; i < cells; i++) {
    if (i >= reveal) break;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cell: Box = { x: area.x + col * (cw + gap), y: top + row * (ch + gap), w: cw, h: ch };
    g.save();
    g.globalAlpha = pen.alpha;
    g.fillStyle = panelFill(s);
    g.fillRect(cell.x, cell.y, cell.w, cell.h);
    if (i < cells - 1) {
      g.beginPath();
      g.rect(cell.x + 6 * u, cell.y + 6 * u, cell.w - 12 * u, cell.h - 12 * u);
      g.clip();
      coverImage(g, shown[i], { x: cell.x + 6 * u, y: cell.y + 6 * u, w: cell.w - 12 * u, h: cell.h - 12 * u });
    }
    g.restore();
    if (i === cells - 1) {
      const at = fitRoad(s.plan, { x: cell.x + 18 * u, y: cell.y + 18 * u, w: cell.w - 36 * u, h: cell.h - 36 * u });
      drawRoad(pen, s.plan, at, 1, 4 * u, false);
    }
  }
}

// --- the DASHBOARD -------------------------------------------------------------------

function paintDash(pen: Pen): void {
  const { g, s, w, u } = pen;
  const box = frameBox(pen);
  const titleEnd = titleBlock(pen, box, 'center', 0.85);
  // The day gauge: an arc of the trip's days, the needle on the days driven.
  const days = s.facts.days ?? 0;
  const total = Math.max(1, s.tripDays, days);
  const cx = w / 2;
  const r = Math.min(box.w * 0.42, (box.h - (titleEnd - box.y)) * 0.3);
  const cy = titleEnd + r + 40 * u;
  const a0 = Math.PI * 0.8;
  const a1 = Math.PI * 2.2;
  const share = (days / total) * pen.count;
  g.save();
  g.globalAlpha = pen.alpha;
  g.lineCap = 'round';
  g.strokeStyle = hexToRgba(s.ink.rule, 0.22);
  g.lineWidth = 16 * u;
  g.beginPath();
  g.arc(cx, cy, r, a0, a1);
  g.stroke();
  g.strokeStyle = s.ink.accent;
  g.beginPath();
  g.arc(cx, cy, r, a0, a0 + (a1 - a0) * share);
  g.stroke();
  // Ticks every tenth of the trip.
  g.lineWidth = 3 * u;
  g.strokeStyle = hexToRgba(s.ink.rule, 0.5);
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((a1 - a0) * i) / 10;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - 30 * u), cy + Math.sin(a) * (r - 30 * u));
    g.lineTo(cx + Math.cos(a) * (r - 46 * u), cy + Math.sin(a) * (r - 46 * u));
    g.stroke();
  }
  // The needle.
  const an = a0 + (a1 - a0) * share;
  g.strokeStyle = s.ink.accent;
  g.lineWidth = 6 * u;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(an) * (r - 50 * u), cy + Math.sin(an) * (r - 50 * u));
  g.stroke();
  g.fillStyle = s.ink.accent;
  g.beginPath();
  g.arc(cx, cy, 12 * u, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const dayCell = s.cells.find((c) => c.fact === 'days');
  if (dayCell) {
    say(pen, 'gauge', cellAt(dayCell, pen.count, s.unit), 110 * u, cx, cy + r * 0.62, 'center');
    say(pen, 'gauge-word', `${dayCell.word} of ${total}`, 26 * u, cx, cy + r * 0.62 + 70 * u, 'center', 0.7);
  }
  // The odometer: the distance in drum cells.
  const kmCell = s.cells.find((c) => c.fact === 'distance');
  const odoY = cy + r + 80 * u;
  if (kmCell) {
    const text = cellAt(kmCell, pen.count, s.unit).replace(/\s/g, '');
    const digits = text.padStart(Math.max(5, text.length), '0');
    const dw = Math.min(96 * u, (box.w * 0.8) / digits.length);
    const dh = dw * 1.4;
    const x0 = cx - (dw * digits.length) / 2;
    g.save();
    g.globalAlpha = pen.alpha;
    for (let i = 0; i < digits.length; i++) {
      g.fillStyle = panelFill(s);
      g.fillRect(x0 + i * dw + 3 * u, odoY, dw - 6 * u, dh);
      g.strokeStyle = hexToRgba(s.ink.rule, 0.35);
      g.lineWidth = 1.5 * u;
      g.strokeRect(x0 + i * dw + 3 * u, odoY, dw - 6 * u, dh);
    }
    g.restore();
    for (let i = 0; i < digits.length; i++) say(pen, `odo:${i}`, digits[i], dw * 0.8, x0 + i * dw + dw / 2, odoY + dh / 2, 'center');
    say(pen, 'odo-unit', kmCell.word, 26 * u, x0 + digits.length * dw + 14 * u, odoY + dh / 2, 'center-left', 0.7);
  }
  // The other facts under it, and the vehicle's name at the foot.
  const rest = s.cells.filter((c) => c.fact !== 'days' && c.fact !== 'distance');
  const footY = box.y + box.h;
  if (rest.length) {
    const fh = factsHeight(u, 64, 22);
    const below = kmCell ? odoY + Math.min(96 * u, (box.w * 0.8) / 5) * 1.4 + 90 * u : cy + r + 60 * u;
    factsRow({ ...pen, s: { ...s, cells: rest } }, { x: box.x, y: Math.min(below, footY - fh - 50 * u), w: box.w, h: fh }, 64, 22);
  }
  say(pen, 'vehicle', s.vehicle, 24 * u, cx, footY, 'bottom-center', 0.6);
}

/** Whether a face covers the whole frame once it has come — the map beneath need not be drawn. */
export function cardCovers(scene: CardScene | null, since: number): boolean {
  return !!scene && since >= 0 && cardProgress(scene.card.cardEntrance, since).alpha >= 1;
}
