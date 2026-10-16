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
import { DAY_STOPS, flightTone, mix, paletteById, parseHex, rgba, sampleCyclic, samplePalette, type Rgb } from './atlas-colour';
import { clockLines, counterLine, formatDate, formatTimeOfDay, graphEnds } from './atlas-hud';
import { paintOverlay, type Block, type OverlayLayout, type StickerBlock, type StickerLogoSource } from './atlas-overlay';
import { inkForGround, luminance, makerKey, stickerParts, stickerText, STICKER_DARK, STICKER_LIGHT } from './atlas-sticker';
import { spotlightStrength, type Episode } from './atlas-spotlight';
import { flightTotalsAt, readStat, statsAt, type AtlasStats } from './atlas-stats';
import { simplify, type AtlasPlace } from './atlas-places';
import { activeAt, flightState, type Schedule, type Slot } from './atlas-schedule';
import { mapRect, resolvedClock, type AtlasSettings, type Rect, type Spot } from './atlas-settings';
import { viewAffine, visibleBox, type Affine, type AtlasView } from './atlas-view';
import type { OverlayHit } from './atlas-layers';
import { PIECE_SPOT, type PieceId } from './atlas-place';
import { flightTime, introLook, outroLook, phaseAt, type Story } from './atlas-story';
import { paintStory, paintVeils } from './atlas-story-paint';

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
  /** When the spotlight follows which flight. */
  episodes: readonly Episode[];
  /** Each flight's aircraft, as the atlas names it (null: unnamed). */
  aircraft: readonly (string | null)[];
  /** Every flight flown whole — what the statistics read when they are not live. */
  totals: AtlasStats;
  /** «12 Jan – 30 May 2026», or null when no flight is dated. */
  dateRange: string | null;
  /** The makers' logos kept on this device, by maker key — what a logo sticker draws. */
  logos: ReadonlyMap<string, StickerLogoSource>;
  /** The film around the flights: what the frame's `t` is measured on. */
  story: Story;
  /** Where a world-dive intro lands — the pin's world point — or null. */
  diveTo: { x: number; y: number } | null;
}

export interface PaintFrame {
  /** STORY time: the intro, then the flights, then the outro. */
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

/**
 * The land as last drawn on a target canvas, kept as a raster of the map's
 * rectangle: the world's coast is thousands of vertices filled through a
 * transform, and it was HALF of a frame's cost (measured headless, 300
 * flights: 8 frames in 2 s with it, 17 without) — while a camera that does
 * not move draws the very same land every frame. Keyed on everything that
 * shapes it; one per target, so the stage and an export never trade theirs.
 * Kept only once the SAME land is asked twice running: a moving camera (a
 * follow, a drift, a dive) draws it directly, as before, and pays no copy.
 */
interface LandRaster {
  key: string;
  land: LandCollection;
  /** The raster, once the key has been asked twice running; null while it has not. */
  surface: OffscreenCanvas | HTMLCanvasElement | null;
}
const landRasters = new WeakMap<object, LandRaster>();

function newSurface(w: number, h: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintLand(ctx: Ctx2D, scene: PaintScene, m: Affine, box: WorldBox, pxPerWorld: number, unit: number, tilesDrawn: boolean, rect: Rect): void {
  const { map } = scene.settings;
  // Under real tiles the 1:50m coast is only a wrong second coastline.
  if (!scene.land || map.land === 'off' || tilesDrawn) return;
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const w = Math.ceil(rect.x + rect.w) - x;
  const h = Math.ceil(rect.y + rect.h) - y;
  const key = [m.a, m.b, m.c, m.d, m.e - x, m.f - y, w, h, map.land, map.landColour, unit, pxPerWorld].join(',');
  const held = landRasters.get(ctx.canvas);
  const same = held !== undefined && held.key === key && held.land === scene.land;
  if (same && held.surface) {
    ctx.drawImage(held.surface, x, y);
    return;
  }
  if (!same) {
    // A land not seen last frame: drawn directly, and remembered by its key.
    landRasters.set(ctx.canvas, { key, land: scene.land, surface: null });
    drawLand(ctx, scene, m, box, pxPerWorld, unit);
    return;
  }
  const surface = newSurface(w, h);
  const into = surface?.getContext('2d') as Ctx2D | null | undefined;
  if (!surface || !into) {
    drawLand(ctx, scene, m, box, pxPerWorld, unit);
    return;
  }
  drawLand(into, scene, { ...m, e: m.e - x, f: m.f - y }, box, pxPerWorld, unit);
  held.surface = surface;
  ctx.drawImage(surface, x, y);
}

function drawLand(ctx: Ctx2D, scene: PaintScene, m: Affine, box: WorldBox, pxPerWorld: number, unit: number): void {
  const { map } = scene.settings;
  if (!scene.land) return;
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

function paintLabels(ctx: Ctx2D, scene: PaintScene, m: Affine, unit: number, rect: Rect): void {
  if (!scene.settings.map.labels) return;
  const ink = parseHex(scene.settings.hud.theme.style.color);
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
    if (x < rect.x - 50 || y < rect.y - 20 || x > rect.x + rect.w + 50 || y > rect.y + rect.h + 20) return;
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

/** Where a flight stands at the frame drawn. */
type State = ReturnType<typeof flightState>;

function roundRect(ctx: Ctx2D, r: Rect, radius: number): void {
  const k = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + k, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  ctx.closePath();
}

/** Where things landed on a painted frame, frame pixels: the map, and each piece of the overlay. */
export interface PaintedFrame {
  map: Rect;
  /** Where the overlay is laid out — the map, or the whole frame — what a dragged piece is placed in. */
  area: Rect;
  hits: OverlayHit[];
  /** The span of the film the frame is in: a click on its map opens the intro or the outro. */
  phase: 'intro' | 'flights' | 'outro';
}

/**
 * Draw one frame of the atlas: the mount (a border, a band for the text,
 * rounded corners), the map inside it, then the overlay — over the map or
 * across the whole frame.
 */
export function paintAtlas(ctx: Ctx2D, scene: PaintScene, storyFrame: PaintFrame): PaintedFrame {
  const s = scene.settings;
  const story = scene.story;
  // Everything about the flights runs on THEIR time; the intro and the outro on the film's.
  const frame: PaintFrame = { ...storyFrame, t: flightTime(story, storyFrame.t) };
  const { width, height, t } = frame;
  const intro = frame.poster ? null : introLook(s.intro, story, storyFrame.t);
  const outro = frame.poster ? null : outroLook(s.outro, story, storyFrame.t);
  const rect = mapRect(s.format, width, height);
  const full = rect.x <= 0 && rect.y <= 0 && rect.w >= width && rect.h >= height && s.format.radius === 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (!full) {
    ctx.fillStyle = s.format.borderColour;
    ctx.fillRect(0, 0, width, height);
  }

  const states: State[] = scene.flights.map((f, fi) =>
    frame.poster
      ? { phase: 'landed' as const, flightT: f.duration, sinceStart: Infinity, sinceEnd: Infinity }
      : flightState(scene.slots[fi], f.duration, s.choreo.tempo, t),
  );
  const spot = frame.poster ? null : spotlightStrength(scene.episodes, t);

  ctx.save();
  if (!full) {
    roundRect(ctx, rect, s.format.radius * Math.min(width, height));
    ctx.clip();
  }
  const tilesDrawn = paintMap(ctx, scene, frame, rect, states, spot);
  if (intro && outro) paintVeils(ctx, scene, rect, intro, outro);
  ctx.restore();

  const area: Rect = s.format.textOn === 'frame' ? { x: 0, y: 0, w: width, h: height } : rect;
  // The flights' overlay steps aside for the intro and the outro.
  const shown = (intro?.overlay ?? 1) * (outro?.overlay ?? 1);
  const hits = shown > 0.001 ? paintOverlay(ctx, overlayLayout(scene, frame, states, spot, tilesDrawn), area, shown) : [];
  if (intro && outro) hits.push(...paintStory(ctx, scene, { width, height, view: frame.view }, rect, intro, outro, stickerBlock(scene, droneNames(scene), tilesDrawn)));
  return { map: rect, area, hits, phase: phaseAt(story, storyFrame.t) };
}

/** Every drone the shown flights name, once each, as the stickers write them. */
function droneNames(scene: PaintScene): string[] {
  return [...new Set(scene.aircraft.filter((n): n is string => !!n))];
}

/** The map, inside `rect` of the frame. True when tiles were drawn under it. */
function paintMap(ctx: Ctx2D, scene: PaintScene, frame: PaintFrame, rect: Rect, states: State[], spot: { flight: number; strength: number } | null): boolean {
  const { t, view } = frame;
  const width = rect.w;
  const height = rect.h;
  const s = scene.settings;
  const unit = Math.min(width, height) / 1080;
  const look = { bearing: s.camera.bearing, tilt: s.camera.tilt };
  const m0 = viewAffine(view, look, width, height);
  // Every point is projected into the frame's own pixels, the map's corner added.
  const m: Affine = { ...m0, e: m0.e + rect.x, f: m0.f + rect.y };
  const pxPerWorld = view.scale * Math.min(width, height);
  const box = visibleBox(view, look, width, height);
  const liftPx = (s.head.lift * unit) / 100;
  const additive = s.colour.additive;
  const bright = additive ? 'lighter' : 'source-over';

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = s.map.background;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Ground.
  const tilesDrawn = scene.tiles
    ? scene.tiles.draw(ctx, m, box, pxPerWorld, { colour: s.map.background, alpha: s.map.tileDim })
    : false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintLand(ctx, scene, m, box, pxPerWorld, unit, tilesDrawn, rect);
  paintGrid(ctx, scene, m, box, pxPerWorld, unit);
  paintLabels(ctx, scene, m, unit, rect);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const smooth = s.trail.smooth;
  const n = scene.flights.length;
  const focus = scene.focus;
  // A hovered flight wins; else the spotlight's, fading the others by its dim.
  const dimOf = (fi: number) => {
    if (focus !== null) return focus === fi ? 1 : 0.18;
    if (spot && spot.flight !== fi) return 1 - s.camera.spotlight.dim * spot.strength;
    return 1;
  };
  const singled = focus ?? (spot && spot.strength > 0.5 ? spot.flight : null);

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
      ctx.strokeStyle = rgba(ghost, Math.min(1, s.trail.ghost * (singled === fi ? 3 : dimOf(fi))));
      trace(ctx, count, smooth, true);
      ctx.stroke();
    }
  }

  // What is flying, what has flown.
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
      if (x < rect.x - 60 || y < rect.y - 60 || x > rect.x + width + 60 || y > rect.y + height + 60) continue;
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
      // The followed drone is drawn a little larger, so the eye finds it.
      const grow = spot && spot.flight === fi ? 1 + 0.5 * spot.strength : 1;
      const r = s.head.size * unit * grow * (1 + s.head.pulse * 0.45 * breath);
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
    const cx = rect.x + width / 2;
    const cy = rect.y + height / 2;
    const g = ctx.createRadialGradient(cx, cy, Math.min(width, height) * 0.25, cx, cy, Math.hypot(width, height) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(0.75 * s.map.vignette).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, width, height);
  }
  return tilesDrawn;
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

// --- the overlay -----------------------------------------------------------------

/** The font strings to load before a draw (the theme's face is added by its owner). */
export const HUD_FONT_FACES = [
  "600 32px 'Space Grotesk'",
  "500 32px 'Space Grotesk'",
  "700 32px 'Space Grotesk'",
  "400 32px 'Instrument Serif'",
  "500 32px 'JetBrains Mono'",
  "600 32px 'JetBrains Mono'",
  "300 32px 'Montserrat'",
  "600 32px 'Montserrat'",
];

/** The tiles' tones, roughly as bright as they land — what an automatic sticker ink reads under Streets. */
const TONE_LUMINANCE: Record<string, number> = { night: 0.02, grey: 0.05, sepia: 0.04, natural: 0.72 };

/**
 * The sticker's ink: the author's, or — `auto` — white or near-black, the
 * better contrast against what lies under the overlay: the mount where the
 * text is laid across the frame, else the map's ground, the tiles dimmed by
 * it under Streets.
 */
export function stickerInk(settings: AtlasSettings, tilesDrawn: boolean): string {
  const { hud, map, format } = settings;
  switch (hud.sticker.ink) {
    case 'text':
      return hud.theme.style.color;
    case 'accent':
      return hud.accent;
    case 'white':
      return STICKER_LIGHT;
    case 'black':
      return STICKER_DARK;
    case 'auto': {
      if (format.textOn === 'frame' && (format.border > 0 || format.band > 0)) return inkForGround(luminance(format.borderColour));
      const ground = luminance(map.background);
      const under = tilesDrawn ? (TONE_LUMINANCE[map.tileTone] ?? 0.05) * (1 - map.tileDim) + ground * map.tileDim : ground;
      return inkForGround(under);
    }
  }
}

/** The drones' stickers: one per name, in its two weights or behind its maker's logo. */
export function stickerBlock(scene: PaintScene, names: readonly string[], tilesDrawn: boolean): StickerBlock {
  const { hud, aircraft } = scene.settings;
  const sticker = hud.sticker;
  const items = names.map((name) => {
    const parts = stickerParts(name, sticker.maker, aircraft.weights[name]);
    const logo = sticker.style === 'logo' ? scene.logos.get(makerKey(parts.maker)) ?? null : null;
    const text = stickerText(parts, sticker.style, logo !== null);
    return { bold: text.bold, light: text.light, logo: text.logo ? logo : null, tint: sticker.logoTint };
  });
  return { kind: 'sticker', items, size: sticker.size, ink: stickerInk(scene.settings, tilesDrawn), backing: sticker.backing, gapAfter: 0.4 };
}

/** What the overlay says at this frame, piece by piece, in its spots. */
export function overlayLayout(
  scene: PaintScene,
  frame: PaintFrame,
  states: readonly State[],
  spot: { flight: number; strength: number } | null,
  tilesDrawn: boolean,
): OverlayLayout {
  const { hud, choreo } = scene.settings;
  const t = frame.t;
  const spots: Partial<Record<Spot, Block[]>> = {};
  // Each piece goes to its spot, or to the place it was dragged to.
  const free = new Map<PieceId, Block[]>();
  const put = (piece: PieceId, ...blocks: Block[]) => {
    const tagged = blocks.map((b) => ({ ...b, piece }));
    if (hud.free[piece]) free.set(piece, [...(free.get(piece) ?? []), ...tagged]);
    else {
      const at = hud[PIECE_SPOT[piece]];
      spots[at] = [...(spots[at] ?? []), ...tagged];
    }
  };
  const z = hud.titleSize;

  if (hud.title) put('title', { kind: 'text', text: hud.title, size: 58 * z, gapAfter: hud.subtitle ? 0 : 0.25, owner: 'title' });
  if (hud.subtitle) put('title', { kind: 'text', text: hud.subtitle, size: 26 * z, weight: 500, gapAfter: 0.5, owner: 'title' });
  if (hud.dates && scene.dateRange) put('dates', { kind: 'text', text: scene.dateRange, size: 22, label: true, gapAfter: 0.25, owner: 'clock' });
  if (hud.drone !== 'off') {
    const names = new Set<string>();
    scene.flights.forEach((_, i) => {
      const name = scene.aircraft[i];
      if (!name) return;
      if (hud.drone === 'all' || (!frame.poster && states[i].phase === 'flying')) names.add(name);
    });
    if (names.size) put('sticker', { ...stickerBlock(scene, [...names], tilesDrawn), owner: 'sticker' });
  }

  // The followed flight's card, while the spotlight holds.
  if (hud.spotCard && spot && spot.strength > 0.5) {
    const f = scene.flights[spot.flight];
    const st = states[spot.flight];
    const p = positionAt(f, st.flightT);
    const live = flightTotalsAt(f, st.flightT);
    const metric = hud.units === 'metric';
    const alt = metric ? `${Math.round(p.alt)} m` : `${Math.round(p.alt * 3.28084)} ft`;
    const speed = metric ? `${Math.round(p.speed * 3.6)} km/h` : `${Math.round((p.speed * 3.6) / 1.609344)} mph`;
    const dist = metric ? `${live.km.toFixed(2)} km` : `${(live.km / 1.609344).toFixed(2)} mi`;
    const blocks: Block[] = [{ kind: 'text', text: f.name, size: 28, weight: 600 }];
    const when = f.startWall !== null ? `${formatDate(f.startWall)} · ${formatTimeOfDay(f.startWall)}` : null;
    if (when) blocks.push({ kind: 'text', text: when, size: 18, label: true });
    const drone = scene.aircraft[spot.flight];
    if (drone) blocks.push({ kind: 'text', text: drone, size: 18, label: true, accent: true });
    blocks.push({ kind: 'row', size: 30, items: [
      { value: alt, label: 'Height' },
      { value: speed, label: 'Speed' },
      { value: dist, label: 'Flown' },
    ] });
    put('card', ...blocks.map((b) => ({ ...b, owner: 'clock' as const })), { kind: 'text', text: ' ', size: 10 });
  }

  const kind = resolvedClock(hud.clock, choreo.mode);
  const lines = frame.poster ? null : clockLines(kind, scene.schedule, t);
  if (lines?.small) put('clock', { kind: 'text', text: lines.small, size: 28, weight: 500, owner: 'clock' });
  if (lines) put('clock', { kind: 'text', text: lines.big, size: 100, owner: 'clock' });
  if (hud.counter && !frame.poster) {
    put('clock', { kind: 'text', text: counterLine(activeAt(scene.slots, t), hud.noun), size: 28, accent: true, weight: 600, gapAfter: 0.3, owner: 'clock' });
  }
  if (hud.graph && !frame.poster && scene.activity.length > 1) {
    put('clock', { kind: 'curve', activity: scene.activity, at: t / Math.max(1e-6, scene.schedule.total), ends: graphEnds(kind, scene.schedule), size: 50, owner: 'clock' });
  }

  if (hud.stats.length) {
    const stats = hud.statsLive && !frame.poster ? statsAt(scene.flights, states.map((st) => (st.phase === 'before' ? null : st.flightT)), scene.placeOf) : scene.totals;
    const live = hud.statsLive && !frame.poster;
    const items = hud.stats.map((key) => {
      const r = readStat(key, stats, hud.units);
      // Only a counting numeral rolls: a total held still would freeze mid-roll.
      return { value: r.text, label: r.label, odometer: live ? r.odometer : undefined };
    });
    put('stats', hud.statsLayout === 'row' ? { kind: 'row', items, size: 44, owner: 'stats' } : { kind: 'column', items, size: 32, owner: 'stats' });
  }

  const credits: string[] = [];
  if (hud.credit) credits.push(`Data: DJI flight telemetry · ${scene.flights.length} flight${scene.flights.length === 1 ? '' : 's'}`);
  // The tiles' licence asks for its credit wherever they are shown — never a switch.
  if (tilesDrawn) credits.push('Map © OpenStreetMap contributors');
  for (const line of credits) put('clock', { kind: 'text', text: line, size: 14, weight: 500, owner: 'clock' });

  return {
    spots,
    free: [...free].map(([piece, blocks]) => ({ place: hud.free[piece]!, blocks })),
    theme: hud.theme,
    accent: hud.accent,
    scale: hud.scale,
  };
}
