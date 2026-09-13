/**
 * Painting the route trace — one frame, read off `RouteShape`.
 *
 * Drawn OVER the picture (the variant is a layer): the trip so far solid, the
 * leg this day belongs to in the accent, the legs still ahead faint and dashed.
 * When the pen animates it draws the trip so far from its first place to the
 * end of the current leg, then lets the rest of the trip appear.
 *
 * A thin dark underlay runs under every stroke. It is what keeps a white line
 * legible over a pale sky without a shadow blur — the one per-frame canvas
 * operation this file deliberately avoids.
 *
 * Sizes are in units of a 1080-wide frame, so the stage and the export draw
 * the same line at two scales.
 */

import type { FrameBox, HookCtx2D } from './hook-variant';
import {
  drawProgress,
  fitProjection,
  revealFractions,
  type Box,
  type LegState,
  type RouteShape,
} from './route-plan';

const ACCENT = '#d9442a';

export type RoutePosition = 'top' | 'middle' | 'bottom';

export interface RoutePaintOptions {
  position: RoutePosition;
  /** 0.5..1.2 of the default box. */
  size: number;
  /** Animate the pen along the trip so far. */
  draw: boolean;
  drawSeconds: number;
}

/** The box the route is fitted into, on a frame of `w`×`h`. */
export function routeBox(w: number, h: number, position: RoutePosition, size: number): Box {
  const width = w * 0.78 * size;
  const height = Math.min(h * 0.36, w * 0.9) * size;
  const x = (w - width) / 2;
  const y =
    position === 'top' ? h * 0.09 : position === 'bottom' ? h * 0.9 - height : (h - height) / 2;
  return { x, y, width, height };
}

// Widths in 1080-units. Checked on a pale sky at preview size: under ~4.5 the
// trip so far read as a hairline, which is not what a route over a reel is for.
const STROKE: Record<LegState, { color: string; width: number; dash: number[] }> = {
  past: { color: 'rgba(255,255,255,0.92)', width: 5, dash: [] },
  current: { color: ACCENT, width: 7.5, dash: [] },
  future: { color: 'rgba(255,255,255,0.55)', width: 3.5, dash: [9, 8] },
};

export function paintRoute(
  g: HookCtx2D,
  shape: RouteShape,
  opts: RoutePaintOptions,
  t: number,
  frame: FrameBox,
): void {
  const { width: w, height: h } = frame;
  if (w <= 0 || h <= 0 || shape.points.length === 0) return;

  const u = w / 1080;
  const project = fitProjection(
    shape.points.map((p) => p.point),
    routeBox(w, h, opts.position, opts.size),
  );
  const segments = shape.segments.map((segment) => ({
    ...segment,
    a: project(segment.from),
    b: project(segment.to),
  }));
  const lengths = segments.map(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y));
  const progress = opts.draw ? drawProgress(t, opts.drawSeconds) : 1;
  const fractions = revealFractions(
    lengths,
    segments.map((s) => s.state),
    progress,
  );
  // The legs still ahead arrive once the pen has reached the current one.
  const futureAlpha = opts.draw
    ? Math.max(0, Math.min(1, (t - opts.drawSeconds * 0.8) / Math.max(0.2, opts.drawSeconds * 0.35)))
    : 1;

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const stroke = (pass: 'under' | 'line') => {
    segments.forEach((segment, i) => {
      const isFuture = segment.state === 'future';
      const f = isFuture ? (futureAlpha > 0 ? 1 : 0) : fractions[i];
      if (f <= 0) return;
      const style = STROKE[segment.state];
      const end = {
        x: segment.a.x + (segment.b.x - segment.a.x) * f,
        y: segment.a.y + (segment.b.y - segment.a.y) * f,
      };
      g.globalAlpha = isFuture ? futureAlpha : 1;
      g.setLineDash(style.dash.map((d) => d * u));
      g.beginPath();
      g.moveTo(segment.a.x, segment.a.y);
      g.lineTo(end.x, end.y);
      if (pass === 'under') {
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.lineWidth = (style.width + 4) * u;
      } else {
        g.strokeStyle = style.color;
        g.lineWidth = style.width * u;
      }
      g.stroke();
    });
  };
  stroke('under');
  stroke('line');
  g.setLineDash([]);

  // Places: a dot each, once the pen has reached it.
  shape.points.forEach(({ point, state }, i) => {
    // The first point is where the pen starts; each later one is reached when
    // the segment arriving at it is fully drawn.
    const arrived =
      state === 'future' ? futureAlpha > 0 : i === 0 ? true : (fractions[i - 1] ?? 0) >= 0.999;
    if (!arrived) return;
    const at = project(point);
    g.globalAlpha = state === 'future' ? futureAlpha * 0.7 : 1;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.arc(at.x, at.y, 8 * u, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = state === 'current' ? ACCENT : '#ffffff';
    g.beginPath();
    g.arc(at.x, at.y, 5 * u, 0, Math.PI * 2);
    g.fill();
  });

  // The pen's tip while it travels.
  if (opts.draw && progress < 1) {
    const i = fractions.findIndex((f, k) => segments[k].state !== 'future' && f > 0 && f < 1);
    if (i >= 0) {
      const s = segments[i];
      const tip = { x: s.a.x + (s.b.x - s.a.x) * fractions[i], y: s.a.y + (s.b.y - s.a.y) * fractions[i] };
      g.globalAlpha = 1;
      g.fillStyle = ACCENT;
      g.beginPath();
      g.arc(tip.x, tip.y, 6.5 * u, 0, Math.PI * 2);
      g.fill();
    }
  }

  // A leg of ONE located place is that place: ring it. No other leg is
  // pinned — a place has no dates, and the badge never names a point.
  if (shape.ring && progress >= 1) {
    const at = project(shape.ring);
    g.globalAlpha = 1;
    g.strokeStyle = ACCENT;
    g.lineWidth = 3 * u;
    g.beginPath();
    g.arc(at.x, at.y, 16 * u, 0, Math.PI * 2);
    g.stroke();
  }

  g.restore();
}
