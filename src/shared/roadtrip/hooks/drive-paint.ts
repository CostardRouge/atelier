/**
 * Painting «&nbsp;Virée&nbsp;» — one frame, read off the plan `prepare()`
 * fixed, the options, and the pictures the shell decoded.
 *
 * The variant OWNS the frame: on paper it covers the piece's picture with a
 * map of its own — cream paper, a faint graticule, a vignette, the road as a
 * dashed line ahead and a solid trail behind the vehicle, a dot and a name at
 * every stop, a compass, a scale bar, the distance so far — and on the
 * picture ground it draws only the road, the stops and the vehicle over whatever
 * is there. Pictures pop as prints beside the vehicle, fanned like a pile on the
 * map, or fill the frame while the vehicle halts. When the vehicle arrives the map
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
import type { VehicleSpec } from '../vehicle-spec';
import { vehicleLight } from './car-model';
import { vehicleModel, type VehicleModel } from './vehicle-registry';
import { hexToRgba } from './colour';
import {
  CARD_FADE_SECONDS,
  PLAN_SIZE,
  applyView,
  cardPlacement,
  distanceNumeral,
  graticuleStep,
  headingAt,
  planBounds,
  pointAt,
  scaleBar,
  viewAt,
  wantsStopLabel,
  type CameraTrack,
  type DriveMoment,
  type DriveOptions,
  type DrivePlan,
  type View,
  wakeStrength,
} from './drive-plan';
import { cameraTrack, widestFrame } from './map-camera';
import {
  BASEMAP_FOR_EDGE,
  BASEMAP_MAX_PX,
  MERCATOR_MAX_LAT,
  basemapKey,
  rasterSize,
  type GeoBox,
} from '../../map/tile-math';
import { STRIP_TILES } from '../../map/tile-strip';
import { paintGround, stripOver, wideOnly, type BasemapSet } from './basemap-strip';
import { basemapRect, paintOsmCredit } from './basemap-paint';
import { paintCount } from './map-paint';
import { formatDistance, placeLabels } from './geo';
import { paintTape } from './scrub-paint';
import { ribbonGeometry, ribbonStyle, type DriveRibbon } from './drive-ribbon';
import type { FrameBox, HookBasemapWant, HookCtx2D, HookPicture } from './hook-variant';
import { drawLookTexts, type LookText } from './look-text';
import { cellAt, type CardScene } from './summary-card';
import { cardCovers, cardProgress, paintCard as paintSummaryCard, paintStampBox } from './summary-paint';
import { themeFromPreset, type StyleTheme } from '../../overlay/title-styles';
import { paintGroundShadow, paintMesh, paintWake, project, renderOrder, toWorld, type Part, type Pose } from './mesh3d';
import { RIDER_SCALE, boardingAt, crossingAt, dockReach, riderBlend, riderTrack, type RiderTrack } from './boarding';
import type { DriveRoad, RoadCrossing, RoadTransition } from './vehicle-plan';

const LABEL_FONT = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
/** The vehicle's length in 1080-units at size 1. */
const CAR_PX = 118;
/** A card's long edge in 1080-units at size 1. */
const CARD_PX = 190;

/**
 * What a paint keeps between frames: the trip's vehicle and its model, the parts
 * — built on the FIRST paint, never in `prepare`, which `deckSlides` calls
 * for every slide just to ask how long the hook is — and the reveal buffer.
 */
export interface DriveScratch {
  spec: VehicleSpec;
  model: VehicleModel;
  parts?: Part[];
  /** A ferry's parts with a ramp down, built the first time it lowers one. */
  withRamp?: { stern?: Part[]; bow?: Part[] };
  /**
   * What drives the road, moment by moment, and where it changed — the
   * trip's fleet per stage, a hop picked by hand, a boat on the water, a
   * repaint on its day (`vehicle-plan.ts`). Absent: `spec` drives it all.
   */
  road?: DriveRoad;
  /** Every vehicle's parts the road has drawn, by model and gear — built on first use. */
  built?: Map<string, Part[]>;
  /** The trip's vehicle riding the ferry this piece borrowed (`boarding.ts`); absent when it does not board. */
  rider?: { spec: VehicleSpec; model: VehicleModel; parts?: Part[] };
  buffer?: OffscreenCanvas | HTMLCanvasElement;
  /** The words the summary card and the milestones say — the trip's badge words, English by default. */
  words: SummaryWords;
  /** The trip's look (`HookContext.theme`), which the summary card's words wear. */
  theme: StyleTheme | null;
}

/** How long a change is marked on the vehicle: a splash or a sweep of paint. */
export const TRANSITION_SECONDS = 0.6;

export interface SummaryWords {
  day: string;
  days: string;
  stop: string;
  stops: string;
}

export const SUMMARY_WORDS: SummaryWords = { day: 'Day', days: 'days', stop: 'Stop', stops: 'stops' };

export function driveScratch(
  spec: VehicleSpec,
  words: Partial<SummaryWords> = {},
  theme: StyleTheme | null = null,
  /** The trip's vehicle, when it drives aboard the ferry `spec` names. */
  rider: VehicleSpec | null = null,
): DriveScratch {
  const w = { ...SUMMARY_WORDS };
  for (const key of Object.keys(w) as (keyof SummaryWords)[]) {
    const given = words[key]?.trim();
    if (given) w[key] = given;
  }
  return {
    spec,
    model: vehicleModel(spec.model),
    words: w,
    theme: theme ?? themeFromPreset('neutral'),
    ...(rider ? { rider: { spec: rider, model: vehicleModel(rider.model) } } : {}),
  };
}

/** A vehicle's parts by model and gear — a ferry's with a ramp down when one is — built once per road. */
function partsFor(scratch: DriveScratch, spec: VehicleSpec, ramp: RiderTrack['ramp'] = null): Part[] {
  const model = vehicleModel(spec.model);
  const lowered = ramp && model.ramps ? ramp : null;
  const key = `${spec.model}:${Object.values(spec.gear).map((on) => (on ? 1 : 0)).join('')}${lowered ? `:${lowered}` : ''}`;
  const built = (scratch.built ??= new Map());
  let parts = built.get(key);
  if (!parts) {
    parts = lowered ? [...partsFor(scratch, spec), ...model.ramps!()[lowered]] : model.build(spec.gear);
    built.set(key, parts);
  }
  return parts;
}

/** The car a ferry the road crosses by carries, as a rider. */
function riderOf(scratch: DriveScratch, spec: VehicleSpec): NonNullable<DriveScratch['rider']> {
  return { spec, model: vehicleModel(spec.model), parts: partsFor(scratch, spec) };
}

/**
 * Where a ferry the road crosses by is drawn, in arc length: docked OFF each
 * shore in the middle of the road — its stern ramp's foot where the car
 * stopped, its bow ramp's at the shore it lands on — and sliding between the
 * two over the crossing, so the car drives straight from the quay up the
 * ramp; centred on the stop at the road's own ends, as a borrowed ferry is.
 * `reach` is how far the car stands from the ship's centre, in plan units.
 */
function dockedS(c: RoadCrossing, ends: { start: boolean; end: boolean }, s: number, reach: { board: number; alight: number }): number {
  const a = c.s0 + (ends.start ? 0 : reach.board);
  const b = c.s1 - (ends.end ? 0 : reach.alight);
  if (!(c.s1 > c.s0) || b <= a) return (a + b) / 2;
  const f = (Math.max(c.s0, Math.min(c.s1, s)) - c.s0) / (c.s1 - c.s0);
  return a + (b - a) * f;
}

/** The last change at or before `t`, while it is still marked. */
function liveTransition(road: DriveRoad | undefined, t: number): RoadTransition | null {
  if (!road) return null;
  let found: RoadTransition | null = null;
  for (const tr of road.transitions) {
    if (tr.t > t) break;
    found = tr;
  }
  return found && t - found.t < TRANSITION_SECONDS ? found : null;
}

function vehicleParts(scratch: DriveScratch, ramp: RiderTrack['ramp'] = null): Part[] {
  if (!scratch.parts) scratch.parts = scratch.model.build(scratch.spec.gear);
  if (!ramp || !scratch.model.ramps) return scratch.parts;
  const kept = (scratch.withRamp ??= {});
  return (kept[ramp] ??= [...scratch.parts, ...scratch.model.ramps()[ramp]]);
}

/** The box the route is fitted into, on a frame of `w`×`h`. */
export function driveBox(w: number, h: number, position: DriveOptions['position'], size: number) {
  const width = w * 0.8 * size;
  const height = Math.min(h * 0.52, w * 1.15) * size;
  const x = (w - width) / 2;
  const y = position === 'top' ? h * 0.1 : position === 'bottom' ? h * 0.92 - height : (h - height) / 2;
  return { x, y, width, height };
}

/**
 * The camera's track for this drive, baked on the nominal 1080-wide frame of
 * the piece's shape: the box, the vehicle's margin and the lead room are all
 * fractions of the frame, so the track reads the same at every size — the
 * stage and the export see one camera.
 */
export function driveTrack(plan: DrivePlan, o: DriveOptions, aspect: number): CameraTrack {
  const w = 1080;
  const h = w / Math.max(1e-6, aspect);
  return cameraTrack(plan, o, driveBox(w, h, o.position, o.size), CAR_PX * o.carSize * 0.7);
}

/** The drive's OpenStreetMap ground: the wide raster and the pyramid along the road (`basemap-strip.ts`). */
export type DriveBasemap = BasemapSet;

/**
 * The OpenStreetMap ground a drive's frame shows, or null unless its ground
 * is `tiles`. Measured on a nominal frame of the piece's shape — the box, the
 * car's margin and the camera are all fractions of the frame, so the region
 * is the same at every size: the whole route as the camera frames it, or,
 * when the camera follows the vehicle, the route with half a frame around it,
 * every place the view can reach. Sized so a 1920 delivery is not enlarged.
 * Under a following camera a zoom PYRAMID of tiles along the road comes with
 * it, each frame's ground at its own density (`stripOver`); `budget` is the
 * tiles it may hold (`stripBudget()`), 0 asks for none.
 */
export function driveBasemap(
  plan: DrivePlan,
  o: DriveOptions,
  aspect: number,
  track: CameraTrack | null = null,
  budget = STRIP_TILES,
): DriveBasemap | null {
  if (o.ground !== 'tiles' || !(aspect > 0)) return null;
  const w = 1080;
  const h = w / aspect;
  const box = driveBox(w, h, o.position, o.size);
  const view = viewAt(plan, box, CAR_PX * o.carSize * 0.7, o, plan.at(0), track);
  if (!(view.scale > 0)) return null;
  let x0: number;
  let x1: number;
  let y0: number;
  let y1: number;
  if (o.camera === 'follow') {
    // The route with half a frame around it — at the WIDEST the camera gets
    // (a pull-back, the wide shots), and the frame's diagonal when the map
    // turns, since a turned frame reaches past its own width.
    const b = planBounds(plan);
    const widest = track ? widestFrame(track) : box.width / view.scale;
    const scale = box.width / Math.max(1e-6, widest);
    const reach = o.orientation === 'heading' ? Math.hypot(w, h) / 2 : 0;
    const hw = Math.max(w / 2, reach) / scale;
    const hh = Math.max(h / 2, reach) / scale;
    x0 = b.x0 - hw;
    x1 = b.x1 + hw;
    y0 = b.y0 - hh;
    y1 = b.y1 + hh;
  } else {
    x0 = -view.tx / view.scale;
    x1 = (w - view.tx) / view.scale;
    y0 = -view.ty / view.scale;
    y1 = (h - view.ty) / view.scale;
  }
  const { geo } = plan;
  if (!(geo.scale > 0) || !(geo.k > 1e-6)) return null;
  const lonOf = (x: number) => ((x - PLAN_SIZE / 2) / geo.scale + geo.midX) / geo.k;
  const latOf = (y: number) => -((y - PLAN_SIZE / 2) / geo.scale + geo.midY);
  const regionOf = (ax0: number, ax1: number, ay0: number, ay1: number): GeoBox => ({
    west: Math.max(-180, lonOf(ax0)),
    east: Math.min(180, lonOf(ax1)),
    north: Math.min(MERCATOR_MAX_LAT, latOf(ay0)),
    south: Math.max(-MERCATOR_MAX_LAT, latOf(ay1)),
  });
  const region = regionOf(x0, x1, y0, y1);
  if (!(region.east > region.west) || !(region.north > region.south)) return null;
  const need = Math.max(x1 - x0, y1 - y0) * view.scale * (BASEMAP_FOR_EDGE / Math.max(w, h));
  const size = rasterSize(region, need, BASEMAP_MAX_PX);
  const wide: HookBasemapWant = { key: basemapKey(region, size.width, size.height), box: region, ...size };
  if (!track || o.camera !== 'follow') return wideOnly(wide);
  return stripOver(wide, track, {
    box,
    frame: { width: w, height: h },
    diagonal: o.orientation === 'heading',
    regionOf,
    unitsPerDegree: geo.scale * geo.k,
    budget,
  });
}

export function paintDrive(
  g: HookCtx2D,
  plan: DrivePlan,
  o: DriveOptions,
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  scratch: DriveScratch,
  t: number,
  frame: FrameBox,
  /** The OpenStreetMap ground, on a `tiles` ground — drawn when the shell has it. */
  basemap: DriveBasemap | null = null,
  /** The baked camera (`map-camera.ts`); null keeps the plain follow of before. */
  track: CameraTrack | null = null,
  /** The recap's ribbon of days under the map (`drive-ribbon.ts`), when asked. */
  ribbon: DriveRibbon | null = null,
  /** The recap's summary card (`summary-card.ts`), when the drive has one. */
  card: CardScene | null = null,
): void {
  const { width: w, height: h } = frame;
  if (w <= 0 || h <= 0) return;
  const moment = plan.at(t);
  if (moment.mapAlpha <= 0) return;
  // A card that covers the frame, once it has come: the map under it is not drawn.
  const { summaryAt } = plan.schedule;
  if (card && card.face !== 'stamp' && summaryAt !== null && cardCovers(card, t - summaryAt)) {
    paintSummaryCard(g, card, pictures, t - summaryAt, frame, t);
    return;
  }

  if (moment.mapAlpha >= 1) {
    paintMap(g, plan, o, pictures, scratch, t, moment, frame, basemap, track, ribbon, card);
    return;
  }
  // The reveal: the whole map at a falling alpha over the picture beneath.
  const buffer = bufferFor(scratch, w, h);
  const bg = buffer?.getContext('2d') as HookCtx2D | null;
  if (!buffer || !bg) {
    paintMap(g, plan, o, pictures, scratch, t, moment, frame, basemap, track, ribbon, card);
    return;
  }
  bg.clearRect(0, 0, w, h);
  paintMap(bg, plan, o, pictures, scratch, t, moment, frame, basemap, track, ribbon, card);
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
  basemap: DriveBasemap | null,
  track: CameraTrack | null,
  ribbon: DriveRibbon | null,
  card: CardScene | null,
): void {
  const { width: w, height: h } = frame;
  const u = w / 1080;
  const carPx = CAR_PX * u * o.carSize;
  // A ship is drawn bigger than a car (`VehicleModel.mapScale`); everything that
  // keeps clear of the vehicle keeps clear of what is drawn.
  // What drives this moment: the road's own answer, else the one vehicle.
  const current = scratch.road ? scratch.road.at(t, moment) : scratch.spec;
  const currentModel = current === scratch.spec ? scratch.model : vehicleModel(current.model);
  const vehiclePx = carPx * (currentModel.mapScale ?? 1);
  const box = driveBox(w, h, o.position, o.size);
  const view = viewAt(plan, box, carPx * 0.7, o, moment, track, t);
  const at = (p: { x: number; y: number }) => applyView(view, p);
  // The map turned (heading-up): what is drawn on the FRAME's axes — the
  // graticule's lines, the tiles' rectangle — is drawn inside this transform
  // against the unturned view, which lands it where `at` would.
  const flat: View = { ...view, angle: 0 };
  const turned = (draw: () => void) => {
    if (!view.angle) {
      draw();
      return;
    }
    g.save();
    g.translate(view.tx, view.ty);
    g.rotate(view.angle);
    g.translate(-view.tx, -view.ty);
    draw();
    g.restore();
  };
  // A direction in plan units, as the frame sees it.
  const turnedDir = (d: { x: number; y: number }) => {
    if (!view.angle) return d;
    const c = Math.cos(view.angle);
    const s = Math.sin(view.angle);
    return { x: d.x * c - d.y * s, y: d.x * s + d.y * c };
  };
  // Tiles are drawn over the paper, so everything on them is inked as on
  // paper: OpenStreetMap's own palette is a light one.
  const onPaper = o.ground !== 'picture';
  const tiles = o.ground === 'tiles' && basemap ? pictures?.get(basemap.wide.key) : undefined;
  // The map as a paper PLATE over a picture filling the frame: the road and
  // the names are then inked as on paper, because they are.
  const plated = o.plate && (o.pictures === 'backdrop' || !onPaper);
  const ink = onPaper || plated ? o.inkColor : '#ffffff';
  const halo = onPaper || plated ? o.paperColor : 'rgba(0,0,0,0.55)';
  const lw = o.lineWidth;

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const showing = o.pictures === 'none' ? [] : plan.showing(t);
  // A picture behind the map: it takes the paper's place while the vehicle
  // halts, the road and the vehicle drawn over it, and fades as the vehicle leaves.
  // Under a plate it pushes in slowly while it shows — a recap's picture is
  // looked at for seconds, and a still one reads as a slide.
  const fullFrame = (rise: number, pop: { key: string; at: number; leaves: number }) => {
    const picture = pictures?.get(pop.key);
    if (!picture) return;
    const leaving = t < pop.leaves ? 1 : Math.max(0, 1 - (t - pop.leaves) / CARD_FADE_SECONDS);
    const alpha = Math.min(1, rise) * leaving;
    if (alpha <= 0) return;
    g.save();
    g.globalAlpha = alpha;
    if (plated) {
      const push = 1 + PUSH_IN * Math.min(1, Math.max(0, t - pop.at) / PUSH_IN_SECONDS);
      g.translate(w / 2, h / 2);
      g.scale(push, push);
      g.translate(-w / 2, -h / 2);
    }
    try {
      drawFramed(g, picture.image, picture.width, picture.height, w, h);
    } catch {
      // A bitmap released under a render in flight: the frame shows the map.
    }
    g.restore();
  };
  const paintPlate = () => {
    if (!plated) return;
    const m = 24 * u;
    roundRect(g, box.x - m, box.y - m, box.width + 2 * m, box.height + 2 * m, 16 * u);
    g.fillStyle = hexToRgba(o.paperColor, 0.84);
    g.fill();
    g.lineWidth = 1.5 * u;
    g.strokeStyle = hexToRgba(o.inkColor, 0.25);
    g.stroke();
  };

  if (onPaper) {
    g.fillStyle = o.paperColor;
    g.fillRect(0, 0, w, h);
    if (tiles && basemap) {
      const { geo } = plan;
      const project = (p: { lat: number; lon: number }) =>
        applyView(flat, geo.at(p, PLAN_SIZE / 2, PLAN_SIZE / 2));
      turned(() => {
        // The pyramid's levels over the wide raster, each frame's ground at
        // the zoom it is delivered at; only what the frame reaches is drawn.
        // Inside `turned()` the frame is the UNTURNED view's, rotated back
        // about (tx, ty) — not about the frame's centre: the square of its
        // half-diagonal around where its centre lands then. Taking the frame's
        // own centre culled the finer tiles of a heading-up camera (measured
        // 2026-10-07: Navigation drew its wide raster three zooms short).
        const reach = view.angle ? Math.hypot(w, h) / 2 : 0;
        const c = Math.cos(-view.angle);
        const s = Math.sin(-view.angle);
        const dx = w / 2 - view.tx;
        const dy = h / 2 - view.ty;
        const mx = view.tx + dx * c - dy * s;
        const my = view.ty + dx * s + dy * c;
        const seen = view.angle
          ? { x0: mx - reach, y0: my - reach, x1: mx + reach, y1: my + reach }
          : { x0: 0, y0: 0, x1: w, y1: h };
        paintGround(g, basemap, tiles, (p) => basemapRect(p, project), seen, t, o.basemapOpacity);
      });
    }
    if (o.pictures === 'backdrop') for (const { pop, rise } of showing) fullFrame(rise, pop);
    paintPlate();
    // The tiles carry their own lines; a graticule over them is noise.
    if (o.graticule && !tiles) turned(() => paintGraticule(g, plan, flat, o, u, frame, view.angle !== 0));
    if (o.vignette) {
      const r = Math.hypot(w, h) / 2;
      const grad = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r * 1.02);
      grad.addColorStop(0, hexToRgba(o.inkColor, 0));
      grad.addColorStop(1, hexToRgba(o.inkColor, 0.26));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  } else {
    if (o.pictures === 'backdrop') for (const { pop, rise } of showing) fullFrame(rise, pop);
    paintPlate();
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

  // The stops: a dot each, filled once the vehicle has passed, a ripple where it halts.
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
      // A halt standing for several places wears their count (`stop-clusters.ts`).
      const members = plan.route.stops[i]?.members ?? 1;
      // Above and to the LEFT: the name is placed on the right, at the dot's height.
      if (members > 1) paintCount(g, p.x - dotR * 2.8, p.y - dotR * 2.2, members, u, reached ? o.trailColor : halo);
    });
  }
  // The milestones: a tick across the road, its number once the vehicle has passed.
  if (plan.milestones.length) paintMilestones(g, plan, o, at, turnedDir, moment, u, ink, halo, scratch.words);

  if (moment.at !== null && !moment.over && (moment.phase === 'halt' || moment.phase === 'stay' || moment.phase === 'arrive')) {
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
      const place = cardPlacement(stops[pop.stop], pop.rank, pop.key, { w: cw + 2 * border, h: ch + 2 * border }, frame, vehiclePx * 0.55, pop.stop);
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

  // The prints lie on the map; the vehicle, a toy standing on it, is drawn over them.
  for (const card of cards) paintCard(g, card, u);

  // The vehicle, its shadow first — and, on a ferry, the trip's vehicle driving on or off it.
  {
    const model = currentModel;
    const spec = current;
    // A ferry the road crosses by carries the road's own car: the ship docks
    // off each shore and the car drives from where it stopped up the stern
    // ramp, and off the bow it grows back to its size to drive on (`boarding.ts`).
    const crossing = scratch.road && !scratch.rider && model.ramps ? crossingAt(scratch.road.crossings, t, plan.path.length) : null;
    const boarding = scratch.rider ? boardingAt(plan.schedule, t) : (crossing?.moment ?? null);
    const riding = scratch.rider ?? (crossing ? riderOf(scratch, crossing.crossing.rider) : null);
    const scale = vehiclePx / model.length;
    let shipPoint = moment.point;
    let shipHeading = moment.heading;
    if (crossing) {
      const toPlan = scale / Math.max(1e-9, view.scale);
      const riderLength = (carPx * RIDER_SCALE) / scale;
      const reach = {
        board: dockReach('board', model.length, riderLength) * toPlan,
        alight: dockReach('alight', model.length, riderLength) * toPlan,
      };
      const s = dockedS(crossing.crossing, crossing.ends, moment.s, reach);
      shipPoint = pointAt(plan.path, s).point;
      shipHeading = headingAt(plan.path, s);
    }
    const p = at(shipPoint);
    const heading = turnedDir(shipHeading);
    const len = Math.hypot(heading.x, heading.y) || 1;
    const pose: Pose = {
      fx: heading.x / len,
      fy: -heading.y / len,
      tilt: (o.tilt * Math.PI) / 180,
      scale,
      x: p.x,
      y: p.y,
      spins: {},
    };
    let rider = riding && boarding ? riderPose(riding, boarding, pose, model.length, carPx) : null;
    // In the middle of the road the car stands on the shore at its own size.
    const roadEnd = crossing && boarding ? (boarding.stage === 'board' ? crossing.ends.start : crossing.ends.end) : true;
    if (rider && boarding && !roadEnd) {
      const k = riderBlend(boarding);
      if (k > 0) {
        const own = turnedDir(moment.heading);
        const ownLen = Math.hypot(own.x, own.y) || 1;
        const shore = at(moment.point);
        rider = onTheShore(rider, { fx: own.x / ownLen, fy: -own.y / ownLen, scale: carPx / riding!.model.length, x: shore.x, y: shore.y }, k);
      }
    }
    const ramp = rider?.track.ramp ?? null;
    const parts = scratch.rider || spec === scratch.spec ? vehicleParts(scratch, ramp) : partsFor(scratch, spec, ramp);
    const change = liveTransition(scratch.road, t);
    const travelled = moment.s * view.scale;
    const spin = travelled / (model.wheelRadius * scale);
    const spins: Record<string, number> = {};
    for (const part of parts) if (part.spin) spins[part.id] = -spin;
    pose.spins = spins;
    const ink = onPaper ? hexToRgba(o.inkColor, 0.85) : 'rgba(10,8,6,0.85)';
    if (model.kind === 'boat') {
      // A boat sits IN the water: a faint shadow, and the wake it leaves while
      // it runs — growing as it gets under way, settling once it halts.
      // A boat taken at a shore mid-run gets under way from the swap, not from the run's start;
      // a ferry waiting at the quay for the car leaves none.
      const since = change?.kind === 'swap' ? Math.min(moment.since, t - change.t) : moment.since;
      const waiting = crossing?.moment?.stage === 'board';
      paintWake(g, pose, model.length, model.width, waiting ? 0 : wakeStrength(moment.phase, since), Math.max(1, carPx / 55), model.wake ?? 1);
      paintGroundShadow(g, pose, model.length / 2, model.width / 2, onPaper ? 0.12 : 0.2);
    } else {
      paintGroundShadow(g, pose, model.length / 2, model.width / 2, onPaper ? 0.28 : 0.4);
    }
    // The vehicle inside the hull, or behind it, is drawn first so the ship
    // covers it as it goes in; out on a ramp nearer the camera, after.
    if (rider && !rider.front) paintRider(g, riding!, rider, onPaper, ink);
    paintMesh(g, renderOrder(parts, pose, vehicleLight(spec.finish)), {
      palette: model.palette(spec.color),
      ink,
      outlineWidth: Math.max(0.9, carPx / 78),
    });
    if (rider && rider.front) paintRider(g, riding!, rider, onPaper, ink);
    if (change) paintChange(g, change, (t - change.t) / TRANSITION_SECONDS, p, vehiclePx, model.kind === 'boat', spec.color, ink);
  }

  // The furniture: a compass, a scale bar, the distance so far.
  const pad = 30 * u;
  if (o.compass) {
    // The rose turns with the map: under heading-up it is what says where north went.
    const cx = w - pad - 22 * u;
    const cy = pad + 30 * u;
    g.save();
    if (view.angle) {
      g.translate(cx, cy);
      g.rotate(view.angle);
      g.translate(-cx, -cy);
    }
    paintCompass(g, cx, cy, u, ink, halo);
    g.restore();
  }
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

  // Défilé's ribbon of days, its head on the recap's clock: on the paper it
  // is inked like the map, over a picture it takes Défilé's own dark band.
  if (ribbon) {
    const overPicture = !onPaper || o.pictures === 'backdrop';
    paintTape(g, ribbon.at(t), ribbonStyle(o, overPicture), ribbonGeometry(w, h, box, o, plated));
  }

  // The licence's credit, wherever the tiles are seen — under a picture that
  // fills the frame, which hides the map with it.
  if (tiles) paintOsmCredit(g, { x: 0, y: 0, width: w, height: h }, u);

  // A picture filling the frame while the vehicle halts: over everything of the map.
  if (o.pictures === 'fill') for (const { pop, rise } of showing) fullFrame(rise, pop);

  // The recap's summary card, once the vehicle has arrived and rested: the
  // stamp in the map's box, any other face over the whole frame.
  const { summaryAt } = plan.schedule;
  if (summaryAt !== null && t >= summaryAt) {
    if (card && card.face !== 'stamp') paintSummaryCard(g, card, pictures, t - summaryAt, frame, t);
    else paintSummary(g, plan, o, box, u, Math.min(1, (t - summaryAt) / SUMMARY_RISE_SECONDS), scratch.words, card?.theme ?? scratch.theme, frame, t, card);
  }

  g.restore();
}

/** A plated picture's push-in: how far, over how long. */
const PUSH_IN = 0.06;
const PUSH_IN_SECONDS = 8;
const SUMMARY_RISE_SECONDS = 0.45;

/**
 * A change marked on the vehicle: a SWAP throws a splash — rings out from
 * where it now floats (a boat) or stands (a car back ashore); a REPAINT is a
 * sweep of the new paint, a disc of its colour opening and fading.
 */
function paintChange(
  g: HookCtx2D,
  change: RoadTransition,
  k: number,
  at: { x: number; y: number },
  vehiclePx: number,
  afloat: boolean,
  color: string,
  ink: string,
): void {
  const fade = 1 - k;
  g.save();
  if (change.kind === 'repaint') {
    const r = vehiclePx * (0.25 + 0.55 * k);
    g.globalAlpha = 0.35 * fade;
    g.fillStyle = color;
    g.beginPath();
    g.arc(at.x, at.y, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.8 * fade;
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1, vehiclePx / 90);
    g.stroke();
  } else {
    g.strokeStyle = afloat ? 'rgba(63,90,114,0.9)' : ink;
    for (const lag of [0, 0.25]) {
      const kk = Math.max(0, k - lag);
      if (kk <= 0) continue;
      g.globalAlpha = 0.7 * (1 - kk);
      g.lineWidth = Math.max(1, vehiclePx / 60) * (1 - kk);
      g.beginPath();
      g.ellipse(at.x, at.y, vehiclePx * (0.3 + 0.6 * kk), vehiclePx * (0.18 + 0.36 * kk), 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.restore();
}

/** Where the riding car is on screen this frame, and whether it is in front of the ship. */
interface RiderPose {
  pose: Pose;
  track: RiderTrack;
  front: boolean;
}

/**
 * The trip's vehicle beside the ship: placed along the ship's own centre line
 * through the ship's pose (`riderTrack`), so it follows the ship's turn and
 * tilt exactly, at its own scale — {@link RIDER_SCALE} of a car's usual length.
 * It is IN FRONT of the ship only out past an end of the hull and nearer the
 * camera than that end; anywhere else the ship covers it.
 */
function riderPose(
  rider: NonNullable<DriveScratch['rider']>,
  boarding: NonNullable<ReturnType<typeof boardingAt>>,
  ship: Pose,
  shipLength: number,
  carPx: number,
): RiderPose {
  const riderPx = carPx * RIDER_SCALE;
  const track = riderTrack(boarding, shipLength, riderPx / ship.scale);
  if (track.alpha <= 0) return { pose: ship, track, front: false };
  const here = project(toWorld([0, track.y, 0], ship), ship);
  const half = shipLength / 2;
  const out = Math.abs(track.y) > half;
  const end = project(toWorld([0, Math.sign(track.y) * half, 0], ship), ship);
  const scale = riderPx / rider.model.length;
  const spin = (track.travelled * ship.scale) / (rider.model.wheelRadius * scale);
  if (!rider.parts) rider.parts = rider.model.build(rider.spec.gear);
  const spins: Record<string, number> = {};
  for (const part of rider.parts) if (part.spin) spins[part.id] = -spin;
  return {
    pose: { fx: ship.fx, fy: ship.fy, tilt: ship.tilt, scale, x: here.x, y: here.y, spins },
    track,
    front: out && here.depth < end.depth,
  };
}

/**
 * The riding car blended toward the road's own full-size car standing on the
 * shore, by `k` (`riderBlend`): its place, its heading, its size — so the car
 * that stopped at the quay is the one that drives aboard, and the one that
 * drives off is the one the road carries on with.
 */
function onTheShore(rider: RiderPose, shore: Pick<Pose, 'fx' | 'fy' | 'scale' | 'x' | 'y'>, k: number): RiderPose {
  const base = rider.pose;
  const mix = (a: number, b: number) => a + (b - a) * k;
  const fx = mix(base.fx, shore.fx);
  const fy = mix(base.fy, shore.fy);
  const len = Math.hypot(fx, fy) || 1;
  return {
    ...rider,
    pose: { ...base, fx: fx / len, fy: fy / len, scale: mix(base.scale, shore.scale), x: mix(base.x, shore.x), y: mix(base.y, shore.y) },
    track: { ...rider.track, alpha: Math.max(rider.track.alpha, k) },
  };
}

function paintRider(g: HookCtx2D, rider: NonNullable<DriveScratch['rider']>, at: RiderPose, onPaper: boolean, ink: string): void {
  if (at.track.alpha <= 0 || !rider.parts) return;
  const { model, spec } = rider;
  g.save();
  g.globalAlpha *= at.track.alpha;
  paintGroundShadow(g, at.pose, model.length / 2, model.width / 2, onPaper ? 0.28 : 0.4);
  paintMesh(g, renderOrder(rider.parts, at.pose, vehicleLight(spec.finish)), {
    palette: model.palette(spec.color),
    ink,
    // The car's own outline at its drawn size: a rider's thinner, the road's car's as it grows back.
    outlineWidth: Math.max(0.7, (at.pose.scale * model.length) / 78),
  });
  g.restore();
}

function paintMilestones(
  g: HookCtx2D,
  plan: DrivePlan,
  o: DriveOptions,
  at: (p: { x: number; y: number }) => { x: number; y: number },
  dir: (d: { x: number; y: number }) => { x: number; y: number },
  moment: DriveMoment,
  u: number,
  ink: string,
  halo: string,
  words: SummaryWords,
): void {
  const unit = o.distance === 'mi' ? 'mi' : 'km';
  g.font = `500 ${18 * u}px ${MONO_FONT}`;
  g.textBaseline = 'middle';
  for (const mark of plan.milestones) {
    const passed = mark.s <= moment.s + 1e-9;
    const p = at(pointAt(plan.path, mark.s).point);
    const d = dir(headingAt(plan.path, mark.s));
    // A tick across the road.
    const half = 9 * u;
    g.beginPath();
    g.moveTo(p.x - d.y * half, p.y + d.x * half);
    g.lineTo(p.x + d.y * half, p.y - d.x * half);
    g.lineWidth = 6 * u;
    g.strokeStyle = halo;
    g.stroke();
    g.lineWidth = 2.5 * u;
    g.strokeStyle = passed ? o.trailColor : hexToRgba(ink, 0.5);
    g.stroke();
    if (!passed) continue;
    const text = mark.kind === 'day' ? `${words.day} ${mark.value}` : `${distanceNumeral(mark.value, 'km')} ${unit}`;
    // The number sits on the side the road is not: to the left of the heading.
    const side = { x: -d.y, y: d.x };
    const x = p.x - side.x * 22 * u;
    const y = p.y - side.y * 22 * u;
    g.textAlign = side.x > 0.2 ? 'right' : side.x < -0.2 ? 'left' : 'center';
    g.lineWidth = 4 * u;
    g.strokeStyle = halo;
    g.strokeText(text, x, y);
    g.fillStyle = ink;
    g.fillText(text, x, y);
  }
}

/**
 * The summary: days · distance · stops, in the map's box — the three
 * numbers of the trip the counter has been counting up to. With a card (the
 * recap's Stamp face) the box wears the card's LOOK — its solid, its frame,
 * its words — or the map's paper when the author picks Paper
 * (`paintStampBox`); without one, the map's paper and ink, as it always did.
 */
function paintSummary(
  g: HookCtx2D,
  plan: DrivePlan,
  o: DriveOptions,
  box: { x: number; y: number; width: number; height: number },
  u: number,
  rise: number,
  words: SummaryWords,
  theme: StyleTheme | null,
  frame: FrameBox,
  t: number,
  /** The card's facts, as the author chose them; absent, days · distance · stops. */
  scene: CardScene | null = null,
): void {
  const n = plan.route.stops.length;
  const unit = o.distance === 'mi' ? 'mi' : 'km';
  const cells: { value: string; word: string }[] = [];
  if (scene) {
    const { count } = cardProgress(scene.card.cardEntrance, t - (plan.schedule.summaryAt ?? t));
    for (const cell of scene.cells) cells.push({ value: cellAt(cell, count, unit), word: cell.word });
  } else {
    if (plan.clock) {
      const days = Math.max(1, Math.round(plan.clock.leave[n - 1] - plan.clock.arrive[0]));
      cells.push({ value: String(days), word: (days === 1 ? words.day : words.days).toLowerCase() });
    }
    cells.push({ value: distanceNumeral(plan.kmAtStop[n - 1], unit), word: unit });
    cells.push({ value: String(n), word: n === 1 ? words.stop.toLowerCase() : words.stops });
  }
  if (!cells.length) return;

  const k = 1 - Math.pow(1 - rise, 3);
  const cw = Math.min(box.width, 200 * u * cells.length);
  const ch = 150 * u;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2 + (1 - k) * 18 * u;
  if (scene) {
    const { count } = cardProgress(scene.card.cardEntrance, t - (plan.schedule.summaryAt ?? t));
    paintStampBox(g, scene, { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch }, u, k, count, frame, t);
    return;
  }
  g.save();
  g.globalAlpha = k;
  // A card lifted off the map: a soft shadow in stacked fills (no blur in
  // this painter), then the paper OPAQUE — the map's names used to show
  // through it (his «tampon translucide»).
  for (const [dy, a] of [[6, 0.05], [3, 0.07]] as const) {
    roundRect(g, cx - cw / 2, cy - ch / 2 + dy * u, cw, ch, 14 * u);
    g.fillStyle = hexToRgba(o.inkColor, a);
    g.fill();
  }
  roundRect(g, cx - cw / 2, cy - ch / 2, cw, ch, 14 * u);
  g.fillStyle = o.paperColor;
  g.fill();
  g.lineWidth = 1.5 * u;
  g.strokeStyle = hexToRgba(o.inkColor, 0.3);
  g.stroke();
  cells.forEach((_, i) => {
    if (i === 0) return;
    const sx = cx - cw / 2 + (cw * i) / cells.length;
    g.strokeStyle = hexToRgba(o.inkColor, 0.18);
    g.lineWidth = 1.5 * u;
    g.beginPath();
    g.moveTo(sx, cy - ch * 0.3);
    g.lineTo(sx, cy + ch * 0.3);
    g.stroke();
  });
  g.restore();
  const texts: LookText[] = [];
  cells.forEach((cell, i) => {
    const x = cx - cw / 2 + (cw * (i + 0.5)) / cells.length;
    texts.push({ id: `summary:value:${i}`, text: cell.value, px: 54 * u, x, y: cy + 8 * u, anchor: 'bottom-center', ink: o.inkColor, alpha: k });
    texts.push({ id: `summary:word:${i}`, text: cell.word, px: 20 * u, x, y: cy + 22 * u, anchor: 'top-center', ink: hexToRgba(o.inkColor, 0.7), alpha: k });
  });
  drawLookTexts(g, texts, frame.width, frame.height, theme, t);
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

/**
 * Faint lines of latitude and longitude at a round step, across the frame.
 * `view` is unturned; a turned map draws this inside the turn, over a reach
 * wide enough that the lines still cross the whole frame.
 */
function paintGraticule(g: HookCtx2D, plan: DrivePlan, view: View, o: DriveOptions, u: number, frame: FrameBox, turned = false): void {
  const { geo } = plan;
  if (!(geo.scale > 0) || !(geo.k > 0)) return;
  const pxPerDegree = geo.scale * view.scale;
  const step = graticuleStep(pxPerDegree, 96 * u);
  // Screen → plan → geo, at the frame's corners — a turned frame reaches its diagonal.
  const reach = turned ? Math.hypot(frame.width, frame.height) : 0;
  const toPlan = (sx: number, sy: number) => ({ x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale });
  const lonOf = (px: number) => ((px - PLAN_SIZE / 2) / geo.scale + geo.midX) / geo.k;
  const latOf = (py: number) => -((py - PLAN_SIZE / 2) / geo.scale + geo.midY);
  const a = toPlan(-reach, -reach);
  const b = toPlan(frame.width + reach, frame.height + reach);
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
    g.moveTo(sx, -reach);
    g.lineTo(sx, frame.height + reach);
  }
  for (let lat = Math.ceil(lat0 / step) * step; lat <= lat1; lat += step) {
    const py = (-lat - geo.midY) * geo.scale + PLAN_SIZE / 2;
    const sy = py * view.scale + view.ty;
    g.moveTo(-reach, sy);
    g.lineTo(frame.width + reach, sy);
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
