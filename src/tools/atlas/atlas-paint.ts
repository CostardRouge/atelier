/**
 * Flight Atlas's PAINTER — one function draws a frame, for the preview and
 * the exported video alike, so what is watched is what is written.
 *
 * Layers, bottom up: the ground (a colour, the shipped coastline, an opt-in
 * OpenStreetMap layer toned to the look, a grid), the GHOST network (every
 * route, faint, from the first frame — the Perth map's violet web), the
 * AFTERGLOW (what each flight leaves once flown), the COMET (the tail behind
 * each flight in the air, fading and thinning towards its end), the HEADS
 * (a dot that breathes, a halo, a ripple at take-off and landing), and the
 * corner: a clock, a count of what is flying, the activity curve.
 *
 * Sizes are given for a 1080 px short side and scaled by the frame's own
 * (`unit`), so a 4K export is the preview, larger. Points are projected by
 * hand through the view's affine (`atlas-view.ts`) into reused buffers; long
 * lines are thinned by Douglas–Peucker at the zoom drawn (`LodCache`), which
 * is what lets a hundred flights play at sixty frames a second.
 */

import type { LandCollection } from '../../shared/map/land';
import { indexAt, positionAt, secondsOfDay, type AtlasFlight, type WorldBox } from './atlas-flight';
import { DAY_STOPS, flightTone, luminance, mix, paletteById, parseHex, rgba, sampleCyclic, samplePalette, type Rgb } from './atlas-colour';
import { clockLines, counterLine, graphEnds } from './atlas-hud';
import { simplify, type AtlasPlace } from './atlas-places';
import { activeAt, flightState, type Schedule, type Slot } from './atlas-schedule';
import { resolvedClock, type AtlasSettings } from './atlas-settings';
import { viewAffine, visibleBox, type Affine, type AtlasView } from './atlas-view';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Whatever map tiles are ready, drawn under the network. */
export interface TileLayer {
  /** Draw the tiles ready for this frame; true when any were drawn. */
  draw(ctx: Ctx2D, m: Affine, box: WorldBox, pxPerWorld: number, dim: { colour: string; alpha: number }): boolean;
}

/** Per-scene numbers every frame reads: the ranges the gradients map onto. */
export interface SceneStats {
  maxAlt: number;
  maxSpeed: number;
  minWall: number | null;
  maxWall: number | null;
}

export interface PaintScene {
  flights: readonly AtlasFlight[];
  /** Aligned with `flights`. */
  slots: readonly Slot[];
  schedule: Schedule;
  settings: AtlasSettings;
  places: readonly AtlasPlace[];
  placeNames: readonly (string | null)[];
  /** The place index of each flight. */
  placeOf: readonly number[];
  land: LandCollection | null;
  tiles: TileLayer | null;
  /** A flight to single out (hovered in the list), or null. */
  focus: number | null;
  /** Flights in the air per graph sample, over `schedule.total`. */
  activity: readonly number[];
  stats: SceneStats;
  lod: LodCache;
}

export interface PaintFrame {
  t: number;
  view: AtlasView;
  width: number;
  height: number;
  /** Every route drawn whole and bright, no heads — a print of the whole set. */
  poster?: boolean;
}

export function sceneStats(flights: readonly AtlasFlight[]): SceneStats {
  let maxAlt = 1;
  let maxSpeed = 1;
  let minWall: number | null = null;
  let maxWall: number | null = null;
  for (const f of flights) {
    maxAlt = Math.max(maxAlt, f.maxAlt);
    maxSpeed = Math.max(maxSpeed, f.maxSpeed);
    if (f.startWall !== null) {
      minWall = minWall === null ? f.startWall : Math.min(minWall, f.startWall);
      maxWall = maxWall === null ? f.startWall : Math.max(maxWall, f.startWall);
    }
  }
  return { maxAlt, maxSpeed, minWall, maxWall };
}

/** Douglas–Peucker indices per flight and per zoom level, computed once each. */
export class LodCache {
  private byFlight = new WeakMap<AtlasFlight, Map<number, Uint32Array>>();

  /** The kept indices for a flight drawn at `pxPerWorld`. */
  get(f: AtlasFlight, pxPerWorld: number): Uint32Array {
    const level = Math.max(0, Math.min(48, Math.round(Math.log2(Math.max(1, pxPerWorld)))));
    let levels = this.byFlight.get(f);
    if (!levels) {
      levels = new Map();
      this.byFlight.set(f, levels);
    }
    let idx = levels.get(level);
    if (!idx) {
      // A third of a pixel at this level.
      idx = simplify(f.xs, f.ys, 0.33 / 2 ** level);
      levels.set(level, idx);
    }
    return idx;
  }
}

// --- point buffers ---------------------------------------------------------------

let bufX = new Float32Array(4096);
let bufY = new Float32Array(4096);
let bufG = new Float32Array(4096); // the ground y, before the lift

function ensure(n: number): void {
  if (bufX.length >= n) return;
  let size = bufX.length;
  while (size < n) size *= 2;
  bufX = new Float32Array(size);
  bufY = new Float32Array(size);
  bufG = new Float32Array(size);
}

/** First position in `idx` whose time is > t. */
function firstAfter(ts: Float32Array, idx: Uint32Array, t: number): number {
  let lo = 0;
  let hi = idx.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[idx[mid]] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Project a flight's line from `t0` to `t1` (capture seconds) into the
 * buffers: an interpolated first point, the kept fixes between, an
 * interpolated last point. Returns the count.
 */
function collect(f: AtlasFlight, idx: Uint32Array, t0: number, t1: number, m: Affine, liftPx: number): number {
  if (t1 <= t0) return 0;
  const start = firstAfter(f.ts, idx, t0);
  const stop = firstAfter(f.ts, idx, t1 - 1e-6);
  ensure(stop - start + 2);
  let n = 0;
  const put = (x: number, y: number, alt: number) => {
    bufX[n] = m.a * x + m.c * y + m.e;
    const gy = m.b * x + m.d * y + m.f;
    bufG[n] = gy;
    bufY[n] = gy - alt * liftPx;
    n += 1;
  };
  const a = positionAt(f, t0);
  put(a.x, a.y, a.alt);
  for (let k = start; k < stop; k++) {
    const i = idx[k];
    put(f.xs[i], f.ys[i], f.alts[i]);
  }
  const b = positionAt(f, t1);
  put(b.x, b.y, b.alt);
  return n;
}

/** Trace the buffered points as a path — curves through them when `smooth`. */
function trace(ctx: Ctx2D, n: number, smooth: boolean, ground = false): void {
  const ys = ground ? bufG : bufY;
  ctx.beginPath();
  ctx.moveTo(bufX[0], ys[0]);
  if (!smooth || n < 3) {
    for (let i = 1; i < n; i++) ctx.lineTo(bufX[i], ys[i]);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    ctx.quadraticCurveTo(bufX[i], ys[i], (bufX[i] + bufX[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
  }
  ctx.lineTo(bufX[n - 1], ys[n - 1]);
}

// --- colour ------------------------------------------------------------------

/** The colour a flight's line takes at capture time `t`. */
function lineColour(scene: PaintScene, fi: number, t: number): Rgb {
  const { colour } = scene.settings;
  const f = scene.flights[fi];
  const stops = paletteById(colour.palette).stops;
  switch (colour.by) {
    case 'single':
      return parseHex(colour.trail);
    case 'flight':
      return samplePalette(stops, flightTone(fi));
    case 'place':
      return samplePalette(stops, flightTone(scene.placeOf[fi] ?? 0));
    case 'altitude': {
      const i = Math.max(0, indexAt(f.ts, t));
      return samplePalette(stops, f.alts[i] / scene.stats.maxAlt);
    }
    case 'speed': {
      const i = Math.max(0, indexAt(f.ts, t));
      return samplePalette(stops, f.speeds[i] / scene.stats.maxSpeed);
    }
    case 'date': {
      const { minWall, maxWall } = scene.stats;
      if (f.startWall === null || minWall === null || maxWall === null || maxWall === minWall) return samplePalette(stops, 0.5);
      return samplePalette(stops, (f.startWall - minWall) / (maxWall - minWall));
    }
    case 'hour': {
      if (f.startWall === null) return samplePalette(DAY_STOPS, 0.5);
      return sampleCyclic(DAY_STOPS, secondsOfDay(f.startWall + t * 1000) / 86_400);
    }
  }
}

/** Whether the line's colour changes along it (so it must be drawn in pieces). */
function varies(scene: PaintScene): boolean {
  const by = scene.settings.colour.by;
  return by === 'altitude' || by === 'speed' || by === 'hour';
}

// --- ground --------------------------------------------------------------------

interface LandRing {
  path: Path2D;
  box: WorldBox;
}

const landRings = new WeakMap<LandCollection, LandRing[]>();

/** The shipped coastline as one Path2D per ring, in WORLD units, built once. */
function ringsOf(land: LandCollection): LandRing[] {
  const known = landRings.get(land);
  if (known) return known;
  const out: LandRing[] = [];
  const MAX_LAT = 85.05112878;
  for (const feature of land.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        const path = new Path2D();
        const box: WorldBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        ring.forEach(([lon, lat], k) => {
          const x = (lon + 180) / 360;
          const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
          const s = Math.sin((l * Math.PI) / 180);
          const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
          if (k === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
          if (x < box.x0) box.x0 = x;
          if (x > box.x1) box.x1 = x;
          if (y < box.y0) box.y0 = y;
          if (y > box.y1) box.y1 = y;
        });
        path.closePath();
        out.push({ path, box });
      }
    }
  }
  landRings.set(land, out);
  return out;
}

function meets(a: WorldBox, b: WorldBox): boolean {
  return a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1;
}

function paintLand(ctx: Ctx2D, scene: PaintScene, m: Affine, box: WorldBox, pxPerWorld: number, unit: number, tilesDrawn: boolean): void {
  const { map } = scene.settings;
  // Under real tiles the 1:50m coast is only a wrong second coastline.
  if (!scene.land || map.land === 'off' || tilesDrawn) return;
  const fill = map.land === 'fill';
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.fillStyle = map.landColour;
  ctx.strokeStyle = map.landColour;
  ctx.lineWidth = (fill ? 0.8 : 1.4) * unit / pxPerWorld;
  ctx.lineJoin = 'round';
  for (const ring of ringsOf(scene.land)) {
    if (!meets(ring.box, box)) continue;
    if (fill) ctx.fill(ring.path, 'evenodd');
    else ctx.stroke(ring.path);
  }
  ctx.restore();
}

function paintGrid(ctx: Ctx2D, scene: PaintScene, m: Affine, box: WorldBox, pxPerWorld: number, unit: number): void {
  const { map } = scene.settings;
  if (map.grid === 'off') return;
  // A power-of-two step that lands near 90 px on a 1080 frame.
  const want = (90 * unit) / pxPerWorld;
  const step = 2 ** Math.round(Math.log2(want));
  const x0 = Math.floor(box.x0 / step) * step;
  const y0 = Math.floor(box.y0 / step) * step;
  const cols = Math.ceil((box.x1 - x0) / step) + 1;
  const rows = Math.ceil((box.y1 - y0) / step) + 1;
  if (cols * rows > 20_000) return;
  const px = (x: number, y: number) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] as const;
  ctx.save();
  if (map.grid === 'lines') {
    ctx.strokeStyle = map.gridColour;
    ctx.lineWidth = Math.max(0.5, 0.8 * unit);
    ctx.beginPath();
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * step;
      const [ax, ay] = px(x, box.y0);
      const [bx, by] = px(x, box.y1);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * step;
      const [ax, ay] = px(box.x0, y);
      const [bx, by] = px(box.x1, y);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = map.gridColour;
    const r = Math.max(0.8, 1.3 * unit);
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < rows; k++) {
        const [x, y] = px(x0 + c * step, y0 + k * step);
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }
  ctx.restore();
}

function paintLabels(ctx: Ctx2D, scene: PaintScene, m: Affine, unit: number, width: number, height: number): void {
  if (!scene.settings.map.labels) return;
  const ink = parseHex(scene.settings.hud.ink);
  const size = Math.round(12.5 * unit * scene.settings.hud.scale);
  ctx.save();
  ctx.font = `500 ${size}px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  scene.places.forEach((p, k) => {
    const name = scene.placeNames[k];
    if (!name) return;
    const wx = (p.box.x0 + p.box.x1) / 2;
    const wy = p.box.y0;
    const x = m.a * wx + m.c * wy + m.e;
    const y = m.b * wx + m.d * wy + m.f - 14 * unit;
    if (x < -50 || y < -20 || x > width + 50 || y > height + 20) return;
    const text = name.toUpperCase();
    const w = ctx.measureText(text).width;
    const r = { x0: x - w / 2 - 6, y0: y - size, x1: x + w / 2 + 6, y1: y + size };
    if (taken.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) return;
    taken.push(r);
    ctx.fillStyle = rgba(ink, 0.5);
    ctx.fillText(text, x, y);
  });
  ctx.restore();
}

// --- the frame -------------------------------------------------------------------

const RIPPLE_S = 0.9;

/** Draw one frame of the atlas. */
export function paintAtlas(ctx: Ctx2D, scene: PaintScene, frame: PaintFrame): void {
  const { width, height, t, view } = frame;
  const s = scene.settings;
  const unit = Math.min(width, height) / 1080;
  const look = { bearing: s.camera.bearing, tilt: s.camera.tilt };
  const m = viewAffine(view, look, width, height);
  const pxPerWorld = view.scale * Math.min(width, height);
  const box = visibleBox(view, look, width, height);
  const liftPx = (s.head.lift * unit) / 100;
  const additive = s.colour.additive;
  const bright = additive ? 'lighter' : 'source-over';

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = s.map.background;
  ctx.fillRect(0, 0, width, height);

  // Ground.
  const tilesDrawn = scene.tiles
    ? scene.tiles.draw(ctx, m, box, pxPerWorld, { colour: s.map.background, alpha: s.map.tileDim })
    : false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintLand(ctx, scene, m, box, pxPerWorld, unit, tilesDrawn);
  paintGrid(ctx, scene, m, box, pxPerWorld, unit);
  paintLabels(ctx, scene, m, unit, width, height);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const smooth = s.trail.smooth;
  const n = scene.flights.length;
  const focus = scene.focus;
  const dimOf = (fi: number) => (focus === null || focus === fi ? 1 : 0.18);

  // The ghost network.
  if (s.trail.ghost > 0 && !frame.poster) {
    const ghost = parseHex(s.colour.ghost);
    ctx.globalCompositeOperation = bright;
    ctx.lineWidth = s.trail.ghostWidth * unit;
    for (let fi = 0; fi < n; fi++) {
      const f = scene.flights[fi];
      if (!meets(f.box, box)) continue;
      const idx = scene.lod.get(f, pxPerWorld);
      const count = collect(f, idx, 0, f.duration, m, 0);
      if (count < 2) continue;
      ctx.strokeStyle = rgba(ghost, s.trail.ghost * (focus === fi ? 3 : dimOf(fi)));
      trace(ctx, count, smooth, true);
      ctx.stroke();
    }
  }

  // What is flying, what has flown.
  const states = scene.flights.map((f, fi) =>
    frame.poster
      ? { phase: 'landed' as const, flightT: f.duration, sinceStart: Infinity, sinceEnd: Infinity }
      : flightState(scene.slots[fi], f.duration, s.choreo.tempo, t),
  );
  const flying = states.reduce((c, st) => c + (st.phase === 'flying' ? 1 : 0), 0);
  const buckets = flying < 60 ? 9 : flying < 200 ? 6 : 3;
  const width0 = s.trail.width * unit;
  const glow = s.colour.glow;

  for (let fi = 0; fi < n; fi++) {
    const f = scene.flights[fi];
    const st = states[fi];
    if (st.phase === 'before') continue;
    if (!meets(f.box, box) && liftPx === 0) continue;
    const idx = scene.lod.get(f, pxPerWorld);
    const dim = dimOf(fi);
    const now = st.flightT;

    if (frame.poster) {
      strokeRange(ctx, scene, fi, idx, 0, f.duration, m, liftPx, width0, 1 * dim, smooth, bright, glow);
      continue;
    }

    // The ground trace under a lifted line.
    if (liftPx > 0 && s.head.shadow) {
      const count = collect(f, idx, 0, now, m, liftPx);
      if (count >= 2) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = rgba(lineColour(scene, fi, now), 0.16 * dim);
        ctx.lineWidth = width0 * 0.7;
        trace(ctx, count, smooth, true);
        ctx.stroke();
      }
    }

    // Afterglow: the whole flown line, faint, fading after landing.
    let after = s.trail.afterglow;
    if (st.phase === 'landed' && s.trail.decay > 0) after *= Math.max(0, 1 - st.sinceEnd / s.trail.decay);
    if (after > 0.003) {
      strokeRange(ctx, scene, fi, idx, 0, now, m, liftPx, width0 * 0.75, after * dim, smooth, bright, 0);
    }

    // The comet: a tail fading and thinning towards its end.
    if (st.phase === 'flying') {
      const tail = Math.max(0.5, s.trail.length * f.duration);
      const from = Math.max(0, now - tail);
      const span = now - from;
      if (span > 0) {
        if (glow > 0) {
          const count = collect(f, idx, from + span * 0.35, now, m, liftPx);
          if (count >= 2) {
            const c = lineColour(scene, fi, now);
            ctx.globalCompositeOperation = bright;
            trace(ctx, count, smooth);
            ctx.strokeStyle = rgba(c, 0.07 * glow * dim);
            ctx.lineWidth = width0 * (2 + 7 * glow);
            ctx.stroke();
            ctx.strokeStyle = rgba(c, 0.16 * glow * dim);
            ctx.lineWidth = width0 * (1.4 + 2.6 * glow);
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = bright;
        for (let k = 0; k < buckets; k++) {
          const a0 = from + (span * k) / buckets;
          const a1 = from + (span * (k + 1)) / buckets;
          const count = collect(f, idx, a0, a1, m, liftPx);
          if (count < 2) continue;
          const pos = (k + 1) / buckets;
          ctx.strokeStyle = rgba(lineColour(scene, fi, (a0 + a1) / 2), pos ** 1.6 * dim);
          ctx.lineWidth = Math.max(0.4, width0 * (1 - s.trail.taper * (1 - pos)));
          ctx.lineCap = k === buckets - 1 ? 'round' : 'butt';
          trace(ctx, count, smooth);
          ctx.stroke();
        }
        ctx.lineCap = 'round';
      }
    }
  }

  // Heads, threads, ripples.
  if (!frame.poster) {
    const headColour = parseHex(s.colour.head);
    for (let fi = 0; fi < n; fi++) {
      const f = scene.flights[fi];
      const st = states[fi];
      const dim = dimOf(fi);
      const ripple = s.head.ripple;
      if (ripple > 0 && st.sinceStart >= 0 && st.sinceStart < RIPPLE_S) {
        const p = positionAt(f, 0);
        drawRipple(ctx, m, p.x, p.y, p.alt * liftPx, st.sinceStart / RIPPLE_S, ripple, unit, lineColour(scene, fi, 0), dim, bright);
      }
      if (ripple > 0 && st.sinceEnd >= 0 && st.sinceEnd < RIPPLE_S) {
        const p = positionAt(f, f.duration);
        drawRipple(ctx, m, p.x, p.y, p.alt * liftPx, st.sinceEnd / RIPPLE_S, ripple * 0.7, unit, lineColour(scene, fi, f.duration), dim, bright);
      }
      if (st.phase !== 'flying' || s.head.size <= 0) continue;
      const p = positionAt(f, st.flightT);
      const x = m.a * p.x + m.c * p.y + m.e;
      const gy = m.b * p.x + m.d * p.y + m.f;
      const y = gy - p.alt * liftPx;
      if (x < -60 || y < -60 || x > width + 60 || y > height + 60) continue;
      if (liftPx > 0 && s.head.tether) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = rgba(headColour, 0.35 * dim);
        ctx.lineWidth = Math.max(0.5, 0.9 * unit);
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = rgba(headColour, 0.4 * dim);
        ctx.beginPath();
        ctx.ellipse(x, gy, 2.2 * unit, 1.2 * unit * s.camera.tilt, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Each head breathes on its own phase, so a swarm shimmers instead of blinking.
      const breath = Math.sin(2 * Math.PI * (s.head.pulseRate * t + flightTone(fi)));
      const r = s.head.size * unit * (1 + s.head.pulse * 0.45 * breath);
      if (s.head.halo > 0) {
        const c = mix(lineColour(scene, fi, st.flightT), headColour, 0.35);
        const hr = r * (2.5 + 5 * s.head.halo) * (1 + s.head.pulse * 0.25 * breath);
        const g = ctx.createRadialGradient(x, y, 0, x, y, hr);
        g.addColorStop(0, rgba(c, 0.55 * s.head.halo * dim));
        g.addColorStop(0.35, rgba(c, 0.18 * s.head.halo * dim));
        g.addColorStop(1, rgba(c, 0));
        ctx.globalCompositeOperation = bright;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, hr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(headColour, dim);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.6, r), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (s.map.vignette > 0) {
    const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.hypot(width, height) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(0.75 * s.map.vignette).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  paintHud(ctx, scene, frame, unit, tilesDrawn);
}

/** A flight's line between two capture times, in one colour or in pieces when the colour varies. */
function strokeRange(
  ctx: Ctx2D,
  scene: PaintScene,
  fi: number,
  idx: Uint32Array,
  t0: number,
  t1: number,
  m: Affine,
  liftPx: number,
  width: number,
  alpha: number,
  smooth: boolean,
  composite: GlobalCompositeOperation,
  glow: number,
): void {
  const f = scene.flights[fi];
  ctx.globalCompositeOperation = composite;
  const pieces = varies(scene) ? Math.max(1, Math.min(24, Math.ceil(((t1 - t0) / Math.max(1, f.duration)) * 24))) : 1;
  for (let k = 0; k < pieces; k++) {
    const a0 = t0 + ((t1 - t0) * k) / pieces;
    const a1 = t0 + ((t1 - t0) * (k + 1)) / pieces;
    const count = collect(f, idx, a0, a1, m, liftPx);
    if (count < 2) continue;
    const c = lineColour(scene, fi, (a0 + a1) / 2);
    trace(ctx, count, smooth);
    if (glow > 0) {
      ctx.strokeStyle = rgba(c, 0.08 * glow * alpha);
      ctx.lineWidth = width * (2 + 5 * glow);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(c, alpha);
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function drawRipple(
  ctx: Ctx2D,
  m: Affine,
  wx: number,
  wy: number,
  lift: number,
  p: number,
  strength: number,
  unit: number,
  c: Rgb,
  dim: number,
  composite: GlobalCompositeOperation,
): void {
  const x = m.a * wx + m.c * wy + m.e;
  const y = m.b * wx + m.d * wy + m.f - lift;
  const ease = 1 - (1 - p) ** 3;
  const r = unit * (4 + 46 * strength) * ease;
  ctx.globalCompositeOperation = composite;
  ctx.strokeStyle = rgba(c, (1 - p) * 0.85 * dim);
  ctx.lineWidth = Math.max(0.6, unit * (2.2 - 1.6 * p));
  ctx.beginPath();
  ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
  ctx.stroke();
}

// --- the corner ------------------------------------------------------------------

const FACES = {
  sans: "'Space Grotesk', system-ui, sans-serif",
  serif: "'Instrument Serif', Georgia, serif",
  mono: "'JetBrains Mono', monospace",
} as const;

/** The font strings the HUD uses, for `document.fonts.load` before a draw. */
export const HUD_FONT_FACES = [
  "600 32px 'Space Grotesk'",
  "500 32px 'Space Grotesk'",
  "400 32px 'Instrument Serif'",
  "500 32px 'JetBrains Mono'",
  "600 32px 'JetBrains Mono'",
];

function paintHud(ctx: Ctx2D, scene: PaintScene, frame: PaintFrame, unit: number, tilesDrawn: boolean): void {
  const { width, height, t } = frame;
  const { hud, choreo } = scene.settings;
  const k = unit * hud.scale;
  const face = FACES[hud.font];
  const bigWeight = hud.font === 'serif' ? 400 : 600;
  const ink = parseHex(hud.ink);
  const accent = parseHex(hud.accent);
  const darkInk = luminance(ink) < 0.4;
  const margin = 44 * unit;
  const kind = resolvedClock(hud.clock, choreo.mode);
  const right = hud.corner === 'br' || hud.corner === 'tr';
  const bottom = hud.corner === 'br' || hud.corner === 'bl';

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  if (!darkInk) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 10 * unit;
  }

  // What the corner holds, top to bottom, each with its height.
  type Row = { h: number; draw: (x: number, y: number, w: number) => void };
  const rows: Row[] = [];
  const lines = frame.poster ? null : clockLines(kind, scene.schedule, t);
  if (lines?.small) {
    const size = 28 * k;
    rows.push({
      h: size * 1.3,
      draw: (x, y) => {
        ctx.font = `500 ${size}px ${face}`;
        ctx.fillStyle = rgba(ink, 0.8);
        ctx.fillText(lines.small as string, x, y + size);
      },
    });
  }
  if (lines) {
    const size = 104 * k;
    rows.push({
      h: size * 1.02,
      draw: (x, y) => {
        ctx.font = `${bigWeight} ${size}px ${face}`;
        ctx.fillStyle = rgba(ink, 1);
        ctx.fillText(lines.big, x - size * 0.04, y + size * 0.86);
      },
    });
  }
  if (hud.counter && !frame.poster) {
    const size = 30 * k;
    const count = activeAt(scene.slots, t);
    rows.push({
      h: size * 1.7,
      draw: (x, y) => {
        ctx.font = `600 ${size}px ${FACES.sans}`;
        ctx.fillStyle = rgba(accent, 1);
        ctx.fillText(counterLine(count, hud.noun), x, y + size * 1.25);
      },
    });
  }
  if (hud.graph && !frame.poster && scene.activity.length > 1) {
    const gh = 54 * k;
    const label = 17 * k;
    rows.push({
      h: gh + label * 1.9,
      draw: (x, y, w) => {
        ctx.save();
        ctx.shadowBlur = 0;
        const max = Math.max(1, ...scene.activity);
        const base = y + gh;
        const nA = scene.activity.length;
        const pt = (i: number) => [x + (i / (nA - 1)) * w, base - (scene.activity[i] / max) * gh * 0.92] as const;
        const cut = frame.poster ? nA - 1 : Math.min(nA - 1, Math.round((t / Math.max(1e-6, scene.schedule.total)) * (nA - 1)));
        // The future, faint; the past, in the accent.
        const curve = (from: number, to: number) => {
          ctx.beginPath();
          const [sx, sy] = pt(from);
          ctx.moveTo(sx, sy);
          for (let i = from + 1; i <= to; i++) {
            const [px, py] = pt(i);
            ctx.lineTo(px, py);
          }
        };
        ctx.lineWidth = 1.6 * k;
        ctx.lineJoin = 'round';
        curve(0, nA - 1);
        ctx.strokeStyle = rgba(accent, 0.18);
        ctx.stroke();
        if (cut > 0) {
          curve(0, cut);
          ctx.strokeStyle = rgba(accent, 1);
          ctx.stroke();
          ctx.lineTo(pt(cut)[0], base);
          ctx.lineTo(x, base);
          ctx.closePath();
          ctx.fillStyle = rgba(accent, 0.12);
          ctx.fill();
        }
        ctx.strokeStyle = rgba(ink, 0.3);
        ctx.lineWidth = Math.max(0.5, 1 * k);
        ctx.beginPath();
        ctx.moveTo(x, base + 0.5);
        ctx.lineTo(x + w, base + 0.5);
        ctx.stroke();
        const [a, b] = graphEnds(kind, scene.schedule);
        ctx.font = `500 ${label}px ${FACES.sans}`;
        ctx.fillStyle = rgba(ink, 0.6);
        ctx.textAlign = 'left';
        ctx.fillText(a, x, base + label * 1.45);
        ctx.textAlign = 'right';
        ctx.fillText(b, x + w, base + label * 1.45);
        ctx.restore();
      },
    });
  }
  const credits: string[] = [];
  if (hud.credit) credits.push(`Data: DJI flight telemetry · ${scene.flights.length} flight${scene.flights.length === 1 ? '' : 's'}`);
  // The tiles' licence asks for its credit wherever they are shown — never a switch.
  if (tilesDrawn) credits.push('Map © OpenStreetMap contributors');
  if (credits.length) {
    const size = 14.5 * k;
    rows.push({
      h: size * 1.5 * credits.length + size * 0.4,
      draw: (x, y) => {
        ctx.font = `500 ${size}px ${FACES.sans}`;
        ctx.fillStyle = rgba(ink, 0.5);
        credits.forEach((line, i) => ctx.fillText(line, x, y + size * (1.2 + 1.5 * i)));
      },
    });
  }

  if (rows.length) {
    const blockW = Math.min(width - margin * 2, Math.max(330 * k, width * 0.27));
    const blockH = rows.reduce((h, r) => h + r.h, 0);
    const x = right ? width - margin - blockW : margin;
    let y = bottom ? height - margin - blockH : margin;
    ctx.textAlign = 'left';
    for (const row of rows) {
      ctx.textAlign = 'left';
      row.draw(x, y, blockW);
      y += row.h;
    }
  }

  // Title and subtitle, at the top on the side away from the corner.
  if (hud.title || hud.subtitle) {
    const tSize = 54 * k;
    const sSize = 24 * k;
    const titleRight = hud.corner === 'tl';
    const tx = titleRight ? width - margin : margin;
    const ty = !bottom && !titleRight ? height - margin - (hud.subtitle ? sSize * 1.6 : 0) : margin + tSize * 0.9;
    ctx.textAlign = titleRight ? 'right' : 'left';
    if (hud.title) {
      ctx.font = `${hud.font === 'serif' ? 400 : 600} ${tSize}px ${face}`;
      ctx.fillStyle = rgba(ink, 1);
      ctx.fillText(hud.title, tx, ty);
    }
    if (hud.subtitle) {
      ctx.font = `500 ${sSize}px ${FACES.sans}`;
      ctx.fillStyle = rgba(ink, 0.65);
      ctx.fillText(hud.subtitle, tx, ty + (hud.title ? sSize * 1.6 : sSize));
    }
  }
  ctx.restore();
}
