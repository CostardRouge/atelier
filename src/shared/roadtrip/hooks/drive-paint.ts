/**
 * Painting «&nbsp;Virée&nbsp;» — one frame, read off the plan `prepare()`
 * fixed, the options, and the pictures the shell decoded.
 *
 * The variant OWNS the frame: on paper it covers the piece's picture with a
 * map of its own — cream paper, a faint graticule, a vignette, the road as a
 * dashed line ahead and a solid trail behind the car, a dot and a name at
 * every stop, a compass, a scale bar, the distance so far — and on the
 * picture ground it draws only the road, the stops and the car over whatever
 * is there. Pictures pop as prints beside the car, fanned like a pile on the
 * map, or fill the frame while the car halts. When the car arrives the map
 * can fade away and leave the piece's own picture, which is where the badge
 * always was.
 *
 * What is drawn is a READING of `DrivePlan.at(t)`, the same closure the
 * score is written from, so a tick lands on the frame its stop appears in.
 * Sizes are in units of a 1080-wide frame, so the stage and the export draw
 * the same map at two scales. The only canvas beyond the one handed in is a
 * buffer for the reveal — the map painted whole, then laid over the picture
 * at a falling alpha — since a fade of a hundred strokes is one drawImage,
 * not a hundred alphas. No shadow blur anywhere: shadows are stacked fills.
 */

import { drawFramed } from '../../media/framing';
import { CAR_LENGTH, CAR_WIDTH, WHEEL_IDS, WHEEL_RADIUS, buildCar, carPalette } from './car-model';
import { hexToRgba } from './colour';
import {
  CARD_FADE_SECONDS,
  PLAN_SIZE,
  applyView,
  cardPlacement,
  graticuleStep,
  scaleBar,
  viewAt,
  wantsStopLabel,
  type DriveMoment,
  type DriveOptions,
  type DrivePlan,
  type View,
} from './drive-plan';
import { formatDistance, placeLabels } from './geo';
import type { FrameBox, HookCtx2D, HookPicture } from './hook-variant';
import { paintGroundShadow, paintMesh, renderOrder, type Part, type Pose } from './mesh3d';

const LABEL_FONT = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
/** The car's length in 1080-units at size 1. */
const CAR_PX = 118;
/** A card's long edge in 1080-units at size 1. */
const CARD_PX = 190;

/** What a paint keeps between frames: the car's parts and the reveal buffer. */
export interface DriveScratch {
  car: Part[];
  buffer?: OffscreenCanvas | HTMLCanvasElement;
}

export function driveScratch(o: DriveOptions): DriveScratch {
  return { car: buildCar({ spare: o.spare, rack: o.rack, mirrors: o.mirrors }) };
}

/** The box the route is fitted into, on a frame of `w`×`h`. */
export function driveBox(w: number, h: number, position: DriveOptions['position'], size: number) {
  const width = w * 0.8 * size;
  const height = Math.min(h * 0.52, w * 1.15) * size;
  const x = (w - width) / 2;
  const y = position === 'top' ? h * 0.1 : position === 'bottom' ? h * 0.92 - height : (h - height) / 2;
  return { x, y, width, height };
}

export function paintDrive(
  g: HookCtx2D,
  plan: DrivePlan,
  o: DriveOptions,
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  scratch: DriveScratch,
  t: number,
  frame: FrameBox,
): void {
  const { width: w, height: h } = frame;
  if (w <= 0 || h <= 0) return;
  const moment = plan.at(t);
  if (moment.mapAlpha <= 0) return;

  if (moment.mapAlpha >= 1) {
    paintMap(g, plan, o, pictures, scratch, t, moment, frame);
    return;
  }
  // The reveal: the whole map at a falling alpha over the picture beneath.
  const buffer = bufferFor(scratch, w, h);
  const bg = buffer?.getContext('2d') as HookCtx2D | null;
  if (!buffer || !bg) {
    paintMap(g, plan, o, pictures, scratch, t, moment, frame);
    return;
  }
  bg.clearRect(0, 0, w, h);
  paintMap(bg, plan, o, pictures, scratch, t, moment, frame);
  g.save();
  g.globalAlpha = moment.mapAlpha;
  g.drawImage(buffer, 0, 0);
  g.restore();
}

function bufferFor(scratch: DriveScratch, w: number, h: number): OffscreenCanvas | HTMLCanvasElement | null {
  const existing = scratch.buffer;
  if (existing && existing.width === w && existing.height === h) return existing;
  let made: OffscreenCanvas | HTMLCanvasElement | null = null;
  if (typeof OffscreenCanvas !== 'undefined') made = new OffscreenCanvas(w, h);
  else if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    made = c;
  }
  if (made) scratch.buffer = made;
  return made;
}

function paintMap(
  g: HookCtx2D,
  plan: DrivePlan,
  o: DriveOptions,
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  scratch: DriveScratch,
  t: number,
  moment: DriveMoment,
  frame: FrameBox,
): void {
  const { width: w, height: h } = frame;
  const u = w / 1080;
  const carPx = CAR_PX * u * o.carSize;
  const box = driveBox(w, h, o.position, o.size);
  const view = viewAt(plan, box, carPx * 0.7, o, moment);
  const at = (p: { x: number; y: number }) => applyView(view, p);
  const onPaper = o.ground === 'paper';
  const ink = onPaper ? o.inkColor : '#ffffff';
  const halo = onPaper ? o.paperColor : 'rgba(0,0,0,0.55)';
  const lw = o.lineWidth;

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const showing = o.pictures === 'none' ? [] : plan.showing(t);
  // A picture behind the map: it takes the paper's place while the car
  // halts, the road and the car drawn over it, and fades as the car leaves.
  const fullFrame = (rise: number, pop: { key: string; leaves: number }) => {
    const picture = pictures?.get(pop.key);
    if (!picture) return;
    const leaving = t < pop.leaves ? 1 : Math.max(0, 1 - (t - pop.leaves) / CARD_FADE_SECONDS);
    const alpha = Math.min(1, rise) * leaving;
    if (alpha <= 0) return;
    g.globalAlpha = alpha;
    try {
      drawFramed(g, picture.image, picture.width, picture.height, w, h);
    } catch {
      // A bitmap released under a render in flight: the frame shows the map.
    }
    g.globalAlpha = 1;
  };

  if (onPaper) {
    g.fillStyle = o.paperColor;
    g.fillRect(0, 0, w, h);
    if (o.pictures === 'backdrop') for (const { pop, rise } of showing) fullFrame(rise, pop);
    if (o.graticule) paintGraticule(g, plan, view, o, u, frame);
    if (o.vignette) {
      const r = Math.hypot(w, h) / 2;
      const grad = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r * 1.02);
      grad.addColorStop(0, hexToRgba(o.inkColor, 0));
      grad.addColorStop(1, hexToRgba(o.inkColor, 0.26));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  } else if (o.pictures === 'backdrop') {
    for (const { pop, rise } of showing) fullFrame(rise, pop);
  }

  // The road: the whole path faint and dashed ahead, the trail solid behind.
  const pts = plan.path.points.map(at);
  if (pts.length > 1) {
    if (o.ahead !== 'hidden') {
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.setLineDash(o.ahead === 'dashed' ? [7 * u * lw, 9 * u * lw] : []);
      g.strokeStyle = onPaper ? hexToRgba(o.aheadColor, o.ahead === 'faint' ? 0.35 : 0.6) : hexToRgba('#ffffff', 0.55);
      g.lineWidth = 3 * u * lw;
      g.stroke();
      g.setLineDash([]);
    }
    if (o.trail && moment.s > 0) {
      const { index } = pointOn(plan, moment.s);
      const carAt = at(moment.point);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= index; i++) g.lineTo(pts[i].x, pts[i].y);
      g.lineTo(carAt.x, carAt.y);
      g.strokeStyle = halo;
      g.lineWidth = 9 * u * lw;
      g.stroke();
      g.strokeStyle = o.trailColor;
      g.lineWidth = 5.5 * u * lw;
      g.stroke();
    }
  }

  // The stops: a dot each, filled once the car has passed, a ripple where it halts.
  const stops = plan.points.map(at);
  const dotR = 7 * u;
  if (o.dots) {
    stops.forEach((p, i) => {
      const reached = i <= moment.reached;
      g.beginPath();
      g.arc(p.x, p.y, dotR + 2.5 * u, 0, Math.PI * 2);
      g.fillStyle = halo;
      g.fill();
      g.beginPath();
      g.arc(p.x, p.y, dotR, 0, Math.PI * 2);
      g.fillStyle = reached ? o.trailColor : onPaper ? o.paperColor : 'rgba(255,255,255,0.9)';
      g.fill();
      g.lineWidth = 2.2 * u;
      g.strokeStyle = reached ? o.trailColor : ink;
      g.stroke();
    });
  }
  if (moment.at !== null && !moment.over && (moment.phase === 'halt' || moment.phase === 'arrive')) {
    const p = stops[moment.at];
    const k = Math.min(1, moment.since / 0.7);
    if (k < 1) {
      g.beginPath();
      g.arc(p.x, p.y, dotR + 34 * u * k, 0, Math.PI * 2);
      g.strokeStyle = hexToRgba(o.trailColor, 0.6 * (1 - k));
      g.lineWidth = 3 * u;
      g.stroke();
    }
  }

  // The cards, so the names can keep clear of them.
  const cardBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const cards: Card[] = [];
  if (o.pictures === 'cards') {
    for (const { pop, rise, fade } of showing) {
      const picture = pictures?.get(pop.key);
      if (!picture || picture.width <= 0 || picture.height <= 0) continue;
      const long = CARD_PX * u * o.cardSize;
      const landscape = picture.width >= picture.height;
      const cw = landscape ? long : (long * picture.width) / picture.height;
      const ch = landscape ? (long * picture.height) / picture.width : long;
      const border = long * 0.05;
      const place = cardPlacement(stops[pop.stop], pop.rank, pop.key, { w: cw + 2 * border, h: ch + 2 * border }, frame, carPx * 0.55, pop.stop);
      cards.push({ picture, x: place.x, y: place.y, w: cw, h: ch, border, angle: place.angle, rise, fade });
      const half = Math.hypot(cw + 2 * border, ch + 2 * border) / 2;
      cardBoxes.push({ x0: place.x - half, y0: place.y - half, x1: place.x + half, y1: place.y + half });
    }
  }

  // The names, each the stop's own, never on top of another or of a card.
  if (o.labels !== 'none' && plan.route.named) {
    const fontPx = 24 * u * o.labelSize;
    g.font = `600 ${fontPx}px ${LABEL_FONT}`;
    g.textBaseline = 'middle';
    const count = plan.route.stops.length;
    const labels = placeLabels(
      plan.route.stops.map((stop, i) => ({ x: stops[i].x, y: stops[i].y, name: stop.name, wanted: wantsStopLabel(o.labels, i, count) })),
      fontPx,
      frame,
      dotR,
      (name) => g.measureText(name).width,
      cardBoxes,
    );
    for (const label of labels) {
      const reached = label.index <= moment.reached;
      const text = plan.route.stops[label.index].name;
      g.textAlign = label.align;
      g.lineWidth = 5 * u;
      g.strokeStyle = halo;
      g.strokeText(text, label.x, label.y);
      g.fillStyle = reached ? ink : hexToRgba(ink, 0.62);
      g.fillText(text, label.x, label.y);
    }
  }

  // The prints lie on the map; the car, a toy standing on it, is drawn over them.
  for (const card of cards) paintCard(g, card, u);

  // The car, its shadow first.
  {
    const p = at(moment.point);
    const heading = moment.heading;
    const len = Math.hypot(heading.x, heading.y) || 1;
    const scale = carPx / CAR_LENGTH;
    const travelled = moment.s * view.scale;
    const spin = travelled / (WHEEL_RADIUS * scale);
    const spins: Record<string, number> = {};
    for (const part of scratch.car) if (part.spin) spins[part.id] = -spin;
    void WHEEL_IDS;
    const pose: Pose = {
      fx: heading.x / len,
      fy: -heading.y / len,
      tilt: (o.tilt * Math.PI) / 180,
      scale,
      x: p.x,
      y: p.y,
      spins,
    };
    paintGroundShadow(g, pose, CAR_LENGTH / 2, CAR_WIDTH / 2, onPaper ? 0.28 : 0.4);
    paintMesh(g, renderOrder(scratch.car, pose), {
      palette: carPalette(o.carColor),
      ink: onPaper ? hexToRgba(o.inkColor, 0.85) : 'rgba(10,8,6,0.85)',
      outlineWidth: Math.max(0.9, carPx / 78),
    });
  }

  // The furniture: a compass, a scale bar, the distance so far.
  const pad = 30 * u;
  if (o.compass) paintCompass(g, w - pad - 22 * u, pad + 30 * u, u, ink, halo);
  if (o.scaleBar) {
    const bar = scaleBar(plan.geo.scale * view.scale, box.width * 0.26, o.distance === 'mi' ? 'mi' : 'km');
    const x = box.x;
    const y = box.y + box.height + 40 * u;
    if (bar.px > 8 * u) {
      g.lineWidth = 6 * u;
      g.strokeStyle = halo;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + bar.px, y);
      g.stroke();
      g.lineWidth = 2.5 * u;
      g.strokeStyle = ink;
      g.beginPath();
      g.moveTo(x, y - 6 * u);
      g.lineTo(x, y);
      g.lineTo(x + bar.px, y);
      g.lineTo(x + bar.px, y - 6 * u);
      g.stroke();
      g.font = `500 ${22 * u}px ${MONO_FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.lineWidth = 4 * u;
      g.strokeStyle = halo;
      g.strokeText(bar.label, x, y + 8 * u);
      g.fillStyle = ink;
      g.fillText(bar.label, x, y + 8 * u);
    }
  }
  if (o.distance !== 'off') {
    const text = formatDistance(plan.kmAt(moment.s), o.distance);
    g.font = `500 ${26 * u}px ${MONO_FONT}`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    const x = box.x + box.width;
    const y = box.y + box.height + 44 * u;
    g.lineWidth = 5 * u;
    g.strokeStyle = halo;
    g.strokeText(text, x, y);
    g.fillStyle = ink;
    g.fillText(text, x, y);
  }

  // A picture filling the frame while the car halts: over everything of the map.
  if (o.pictures === 'fill') for (const { pop, rise } of showing) fullFrame(rise, pop);

  g.restore();
}

/** The sample before `s` on the path — what the trail is drawn up to. */
function pointOn(plan: DrivePlan, s: number): { index: number } {
  const { cum } = plan.path;
  let lo = 0;
  let hi = cum.length - 1;
  if (hi <= 0) return { index: 0 };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return { index: lo };
}

/** Faint lines of latitude and longitude at a round step, across the frame. */
function paintGraticule(g: HookCtx2D, plan: DrivePlan, view: View, o: DriveOptions, u: number, frame: FrameBox): void {
  const { geo } = plan;
  if (!(geo.scale > 0) || !(geo.k > 0)) return;
  const pxPerDegree = geo.scale * view.scale;
  const step = graticuleStep(pxPerDegree, 96 * u);
  // Screen → plan → geo, at the frame's corners.
  const toPlan = (sx: number, sy: number) => ({ x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale });
  const lonOf = (px: number) => ((px - PLAN_SIZE / 2) / geo.scale + geo.midX) / geo.k;
  const latOf = (py: number) => -((py - PLAN_SIZE / 2) / geo.scale + geo.midY);
  const a = toPlan(0, 0);
  const b = toPlan(frame.width, frame.height);
  const lon0 = Math.min(lonOf(a.x), lonOf(b.x));
  const lon1 = Math.max(lonOf(a.x), lonOf(b.x));
  const lat0 = Math.min(latOf(a.y), latOf(b.y));
  const lat1 = Math.max(latOf(a.y), latOf(b.y));
  if (!Number.isFinite(lon0) || !Number.isFinite(lat0) || (lon1 - lon0) / step > 200 || (lat1 - lat0) / step > 200) return;
  g.save();
  g.strokeStyle = hexToRgba(o.inkColor, 0.13);
  g.lineWidth = 1.2 * u;
  g.beginPath();
  for (let lon = Math.ceil(lon0 / step) * step; lon <= lon1; lon += step) {
    const px = (lon * geo.k - geo.midX) * geo.scale + PLAN_SIZE / 2;
    const sx = px * view.scale + view.tx;
    g.moveTo(sx, 0);
    g.lineTo(sx, frame.height);
  }
  for (let lat = Math.ceil(lat0 / step) * step; lat <= lat1; lat += step) {
    const py = (-lat - geo.midY) * geo.scale + PLAN_SIZE / 2;
    const sy = py * view.scale + view.ty;
    g.moveTo(0, sy);
    g.lineTo(frame.width, sy);
  }
  g.stroke();
  g.restore();
}

interface Card {
  picture: HookPicture;
  x: number;
  y: number;
  w: number;
  h: number;
  border: number;
  angle: number;
  rise: number;
  fade: number;
}

/** Ease-out with a little overshoot — the pop of a print landing on the map. */
function overshoot(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

function paintCard(g: HookCtx2D, card: Card, u: number): void {
  const scale = 0.72 + 0.28 * overshoot(Math.max(0, Math.min(1, card.rise)));
  const alpha = card.fade * Math.min(1, card.rise * 4);
  if (alpha <= 0) return;
  const W = card.w + 2 * card.border;
  const H = card.h + 2 * card.border;
  g.save();
  g.globalAlpha = alpha;
  g.translate(card.x, card.y);
  g.rotate(card.angle);
  g.scale(scale, scale);
  // A stacked shadow, no blur.
  for (const [grow, dy, a] of [
    [1.06, 7 * u, 0.1],
    [1.03, 4 * u, 0.14],
    [1.0, 2 * u, 0.18],
  ] as const) {
    g.fillStyle = `rgba(20,16,12,${a})`;
    roundRect(g, (-W * grow) / 2, -H / 2 + dy, W * grow, H * grow, 3 * u);
    g.fill();
  }
  g.fillStyle = '#fbf8f1';
  roundRect(g, -W / 2, -H / 2, W, H, 3 * u);
  g.fill();
  try {
    g.drawImage(card.picture.image, -card.w / 2, -card.h / 2, card.w, card.h);
  } catch {
    // A bitmap released under a render in flight: the print stays blank.
  }
  g.restore();
}

function roundRect(g: HookCtx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
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

/** A compass rose: a four-point star and its N. North is up because the projection is. */
function paintCompass(g: HookCtx2D, cx: number, cy: number, u: number, ink: string, halo: string): void {
  const R = 22 * u;
  const r = 7 * u;
  const star = () => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? R : r;
      const x = cx + rad * Math.cos(a);
      const y = cy + rad * Math.sin(a);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };
  star();
  g.lineWidth = 6 * u;
  g.strokeStyle = halo;
  g.stroke();
  star();
  g.fillStyle = halo;
  g.fill();
  g.lineWidth = 2 * u;
  g.strokeStyle = ink;
  g.stroke();
  // The north point filled in ink.
  g.beginPath();
  g.moveTo(cx, cy - R);
  g.lineTo(cx + r * Math.cos(-Math.PI / 4), cy + r * Math.sin(-Math.PI / 4));
  g.lineTo(cx, cy);
  g.lineTo(cx + r * Math.cos((-3 * Math.PI) / 4), cy + r * Math.sin((-3 * Math.PI) / 4));
  g.closePath();
  g.fillStyle = ink;
  g.fill();
  g.font = `600 ${16 * u}px ${MONO_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 4 * u;
  g.strokeStyle = halo;
  g.strokeText('N', cx, cy - R - 12 * u);
  g.fillStyle = ink;
  g.fillText('N', cx, cy - R - 12 * u);
}
