/**
 * Painting the route trace — one frame, read off `RouteShape`, the options
 * and the timing `prepare()` fixed.
 *
 * Drawn OVER the picture (the variant is a layer): the trip so far solid, the
 * leg this day belongs to in the accent, the legs still ahead faint. When the
 * pen animates it draws the trip so far from its first place to the end of
 * the current leg, then lets the rest of the trip appear.
 *
 * Everything the author can switch on beyond the line — a plate behind it,
 * the places' names, a compass, the distance so far — is drawn here from the
 * same projection, so nothing can sit where the line is not. A thin dark
 * underlay runs under every stroke and every glyph: it is what keeps a white
 * line legible over a pale sky without a per-frame shadow blur, the one
 * canvas operation this file deliberately avoids.
 *
 * Sizes are in units of a 1080-wide frame, so the stage and the export draw
 * the same line at two scales.
 */

import { hexToRgba } from './colour';
import type { FrameBox, HookCtx2D } from './hook-variant';
import {
  drawnKm,
  fitProjection,
  formatDistance,
  futureAlphaAt,
  penProgress,
  placeLabels,
  revealFractions,
  routeBox,
  segmentKms,
  wantsLabel,
  type LegState,
  type RouteOptions,
  type RouteShape,
  type RouteTiming,
} from './route-plan';

// Widths in 1080-units at line width 1. Checked on a pale sky at preview
// size: under ~4.5 the trip so far read as a hairline, which is not what a
// route over a reel is for.
const WIDTH: Record<LegState, number> = { past: 5, current: 7.5, future: 3.5 };
const FUTURE_DASH = [9, 8];
const UNDERLAY = 'rgba(0,0,0,0.3)';
// The suite's faces, with a system fallback each: a glyph must survive a
// font stack we do not control (`roadtrip.md`).
const LABEL_FONT = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";

function lineColor(o: RouteOptions, state: LegState): string {
  if (state === 'current') return o.currentColor;
  if (state === 'past') return hexToRgba(o.pastColor, 0.92);
  return hexToRgba(o.futureColor, o.futureStyle === 'faint' ? 0.35 : 0.55);
}

export function paintRoute(
  g: HookCtx2D,
  shape: RouteShape,
  o: RouteOptions,
  timing: RouteTiming,
  t: number,
  frame: FrameBox,
): void {
  const { width: w, height: h } = frame;
  if (w <= 0 || h <= 0 || shape.points.length === 0) return;

  const u = w / 1080;
  const box = routeBox(w, h, o.position, o.align, o.size);
  // The projection fits every point that will EVER be drawn, from the first
  // frame, so nothing jumps when the legs ahead arrive — and no more: legs
  // that are hidden never arrive, so they do not shrink the line either.
  const fitted = o.futureStyle === 'hidden' ? shape.points.filter((p) => p.state !== 'future') : shape.points;
  const project = fitProjection(
    fitted.map((p) => p.point),
    box,
  );
  const segments = shape.segments.map((segment) => ({
    ...segment,
    a: project(segment.from),
    b: project(segment.to),
  }));
  const lengths = segments.map(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y));
  const states = segments.map((s) => s.state);
  const progress = o.draw ? penProgress(t, timing.delay, timing.draw, o.easing) : 1;
  const fractions = revealFractions(lengths, states, progress);
  const futureAlpha = futureAlphaAt(o, timing, t);
  const showFuture = o.futureStyle !== 'hidden' && futureAlpha > 0;
  const lw = o.lineWidth;
  const dotR = 5 * u * o.dotSize;
  const projected = shape.points.map((p) => project(p.point));
  // The first point is where the pen starts; each later one is reached when
  // the segment arriving at it is fully drawn; a leg ahead arrives with the rest.
  const arrived = shape.points.map(({ state }, i) =>
    state === 'future' ? showFuture : i === 0 ? true : (fractions[i - 1] ?? 0) >= 0.999,
  );

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (o.plate) {
    // Room for the names beside the outermost dots, the compass above, the
    // distance below — clamped to the frame, since a name's length is not ours.
    const padX = 40 * u + (o.labels !== 'none' ? 90 * u * o.labelSize : 0);
    const top = box.y - (o.compass ? 104 * u : 36 * u);
    const bottom = box.y + box.height + (o.distance !== 'off' ? 70 * u : 36 * u);
    const x0 = Math.max(8 * u, box.x - padX);
    const x1 = Math.min(w - 8 * u, box.x + box.width + padX);
    g.globalAlpha = 1;
    g.fillStyle = hexToRgba(o.plateColor, o.plateOpacity);
    roundedRect(g, x0, top, x1 - x0, bottom - top, 20 * u);
    g.fill();
  }

  const stroke = (pass: 'under' | 'line') => {
    segments.forEach((segment, i) => {
      const isFuture = segment.state === 'future';
      if (isFuture && !showFuture) return;
      const f = isFuture ? 1 : fractions[i];
      if (f <= 0) return;
      const end = {
        x: segment.a.x + (segment.b.x - segment.a.x) * f,
        y: segment.a.y + (segment.b.y - segment.a.y) * f,
      };
      g.globalAlpha = isFuture ? futureAlpha : 1;
      g.setLineDash(isFuture && o.futureStyle === 'dashed' ? FUTURE_DASH.map((d) => d * u) : []);
      g.beginPath();
      g.moveTo(segment.a.x, segment.a.y);
      g.lineTo(end.x, end.y);
      if (pass === 'under') {
        g.strokeStyle = UNDERLAY;
        g.lineWidth = (WIDTH[segment.state] * lw + 4) * u;
      } else {
        g.strokeStyle = lineColor(o, segment.state);
        g.lineWidth = WIDTH[segment.state] * lw * u;
      }
      g.stroke();
    });
  };
  if (o.underlay) stroke('under');
  stroke('line');
  g.setLineDash([]);

  if (o.dots) {
    shape.points.forEach(({ state }, i) => {
      if (!arrived[i]) return;
      const at = projected[i];
      g.globalAlpha = state === 'future' ? futureAlpha * 0.7 : 1;
      if (o.underlay) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath();
        g.arc(at.x, at.y, dotR + 3 * u, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle =
        state === 'current' ? o.currentColor : state === 'past' ? o.pastColor : o.futureColor;
      g.beginPath();
      g.arc(at.x, at.y, dotR, 0, Math.PI * 2);
      g.fill();
    });
  }

  if (o.labels !== 'none') {
    const fontPx = 26 * u * o.labelSize;
    g.font = `600 ${fontPx}px ${LABEL_FONT}`;
    g.textBaseline = 'middle';
    const count = shape.points.length;
    const labels = placeLabels(
      shape.points.map(({ point, state }, i) => ({
        x: projected[i].x,
        y: projected[i].y,
        name: point.name,
        wanted: arrived[i] && wantsLabel(o.labels, i, count, state),
      })),
      fontPx,
      frame,
      o.dots ? dotR : 2 * u,
      (name) => g.measureText(name).width,
    );
    for (const label of labels) {
      const { state, point } = shape.points[label.index];
      g.textAlign = label.align;
      g.globalAlpha = state === 'future' ? futureAlpha * 0.8 : 1;
      if (o.underlay) {
        g.lineWidth = 4 * u;
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.strokeText(point.name.trim(), label.x, label.y);
      }
      g.fillStyle = state === 'current' ? o.currentColor : o.pastColor;
      g.fillText(point.name.trim(), label.x, label.y);
    }
  }

  // The pen's tip while it travels.
  if (o.draw && o.pen === 'dot' && progress < 1) {
    const i = fractions.findIndex((f, k) => states[k] !== 'future' && f > 0 && f < 1);
    if (i >= 0) {
      const s = segments[i];
      const tip = { x: s.a.x + (s.b.x - s.a.x) * fractions[i], y: s.a.y + (s.b.y - s.a.y) * fractions[i] };
      g.globalAlpha = 1;
      g.fillStyle = o.currentColor;
      g.beginPath();
      g.arc(tip.x, tip.y, 6.5 * u * o.dotSize, 0, Math.PI * 2);
      g.fill();
    }
  }

  // A leg of ONE located place is that place: ring it. No other leg is
  // pinned — a place has no dates, and the badge never names a point.
  if (o.ringCurrent && shape.ring && progress >= 1) {
    const at = project(shape.ring);
    g.globalAlpha = 1;
    g.strokeStyle = o.currentColor;
    g.lineWidth = 3 * u * lw;
    g.beginPath();
    g.arc(at.x, at.y, 16 * u * o.dotSize, 0, Math.PI * 2);
    g.stroke();
  }

  if (o.compass) paintCompass(g, o, box.x + box.width - 16 * u, box.y - 52 * u, u);

  if (o.distance !== 'off') {
    const km = drawnKm(segmentKms(shape), fractions);
    const text = formatDistance(km, o.distance);
    g.font = `500 ${28 * u}px ${MONO_FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = o.align === 'right' ? 'right' : 'left';
    const x = o.align === 'right' ? box.x + box.width : box.x;
    const y = box.y + box.height + 44 * u;
    g.globalAlpha = 1;
    if (o.underlay) {
      g.lineWidth = 5 * u;
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.strokeText(text, x, y);
    }
    g.fillStyle = o.pastColor;
    g.fillText(text, x, y);
  }

  g.restore();
}

/** A north arrow with its letter — north is up because the projection is. */
function paintCompass(g: HookCtx2D, o: RouteOptions, cx: number, cy: number, u: number): void {
  const half = 17 * u;
  g.globalAlpha = 1;
  g.lineCap = 'round';
  const shaft = (pass: 'under' | 'line') => {
    g.strokeStyle = pass === 'under' ? 'rgba(0,0,0,0.5)' : o.pastColor;
    g.lineWidth = (pass === 'under' ? 8 : 3.5) * u;
    g.beginPath();
    g.moveTo(cx, cy + half);
    g.lineTo(cx, cy - half + 6 * u);
    g.stroke();
  };
  if (o.underlay) shaft('under');
  shaft('line');
  // The head, in the accent: the one thing on the compass that points.
  g.fillStyle = o.currentColor;
  g.beginPath();
  g.moveTo(cx, cy - half - 2 * u);
  g.lineTo(cx - 7 * u, cy - half + 12 * u);
  g.lineTo(cx + 7 * u, cy - half + 12 * u);
  g.closePath();
  g.fill();
  g.font = `600 ${20 * u}px ${MONO_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (o.underlay) {
    g.lineWidth = 4 * u;
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.strokeText('N', cx, cy - half - 16 * u);
  }
  g.fillStyle = o.pastColor;
  g.fillText('N', cx, cy - half - 16 * u);
}

function roundedRect(g: HookCtx2D, x: number, y: number, w: number, h: number, r: number): void {
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
