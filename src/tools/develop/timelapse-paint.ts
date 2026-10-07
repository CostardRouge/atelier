/**
 * The PAINTER of a making-of video — one `draw(script, t)` for the preview
 * and the export alike (`docs/develop-timelapse.md` §3.3), so the two cannot
 * disagree.
 *
 * A raster per STATE, graded once: every state the script names (the
 * picture as shot, then each kept chapter's after) is rendered through the
 * export's own pass chain (`picturePasses`, the seam T4 cut) into an
 * `ImageBitmap` held for the run — the hook-video's `gradedOnce` rule, and
 * `holdGrades`'. A transition is then a CROSSFADE of two rasters: cheap,
 * exact at both ends. What a crossfade cannot fake is a crop, so a crop
 * chapter draws the picture before it with the ZONE growing over it — the
 * veil, the outline, the thirds, the crop stage's own figure — and cuts to
 * the picture after. The tools are drawn from each chapter's geometry: a
 * heal's rings, a mask's fill. The frame fits the delivered picture over a
 * ground, the camera is a transform about the chapter's target, the captions
 * are the script's `OverlayElement`s through `drawOverlays`, and the reveal
 * draws two rasters across a divider — the first export in the suite to.
 *
 * Grain is FROZEN here: every state is graded once, so a grained look holds
 * one field — the limit a painted hook clip already has (`render-film.md`).
 *
 * DOM: canvases and bitmaps. The arithmetic it reads is pure and tested in
 * `timelapse-script.ts` and `timelapse-chapters.ts`.
 */

import type { ProfileRequest } from '../../shared/raw/dng-color';
import { isDefaultDevelop, isRawDevelop, withoutBase } from '../../shared/develop/develop';
import { drawingLayers } from '../../shared/develop/layer';
import { picturePasses, type PassSettings } from '../../shared/develop/roll-render';
import { needsSubjectRasters, resolveSubjectRasters } from '../../shared/develop/subject-rasters';
import { segmentationView } from '../../shared/develop/segment-view';
import { pictureAspectRatio } from '../../shared/develop/crop-aspect';
import { deliveredLayout } from '../../shared/develop/roll-export';
import { boxBlurRGBA, scaleLayout, type BorderLayout } from '../../shared/develop/border-layout';
import { drawDelivered, drawPictureIn } from '../../shared/develop/border-paint';
import { frameAffine } from '../../shared/develop/vignette-frame';
import type { RollPicture } from '../../shared/develop/roll-types';
import { LOOP_SECONDS, TRANSITION_SHARE, CAMERA_TRAVEL_SECONDS, momentAt, chapterAt, pairAt, progressSegments, type PairFrame, type ScriptChapter, type TimelapseScript } from '../../shared/develop/timelapse-script';
import { WHOLE_PICTURE, type Camera } from '../../shared/develop/timelapse-chapters';
import { isSilentTexture } from '../../shared/film/film-texture';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader, type GradeSource } from '../../shared/lut/frame-grader';
import { DEFAULT_FRAMING, framePoint, unframePoint, type Framing } from '../../shared/media/framing';
import { decodeStill } from '../../shared/media/still-decode';
import { easeAt } from '../../shared/motion/easing';
import { drawOverlays } from '../../shared/overlay/draw-overlays';
import { ensureOverlayFonts } from '../../shared/overlay/fonts';
import { themeFromPreset } from '../../shared/overlay/title-styles';
import { decodeRaw } from '../../shared/raw/raw-decoder';
import type { GainField } from '../../shared/render/gain-map';
import type { CameraWarp } from '../../shared/render/camera-warp';
import { hasGeometry } from '../../shared/render/picture-geometry';
import { isDefaultDetail } from '../../shared/render/detail';
import { maskAt } from '../../shared/render/mask';
import type { BrushRaster } from '../../shared/render/brush-raster';
import { profileInEffect } from '../../shared/lens/lens-profile';
import type { RollCubes } from './roll-cubes';

/** The bytes a making-of is made from — what the stage draws, and the sensor where the picture is developed on it. */
export interface TimelapseSource {
  file: File;
  raw: { file: File; gain: number; profile?: ProfileRequest } | null;
  calibration: { gain: GainField | null; warp: CameraWarp | null } | null;
}

export interface PrepareOptions {
  cubes: RollCubes;
  /** The long edge the picture is decoded and graded at — the frame's times the deepest zoom for a file, less for a preview. */
  edge: number;
  /** The painter's canvas; the script's frame when absent. Everything is drawn in fractions, so a preview is the file scaled. */
  size?: { width: number; height: number } | null;
  /** Draw into this canvas (a preview's on the page) instead of one of the painter's own. */
  canvas?: HTMLCanvasElement | null;
  signal?: AbortSignal;
  /** Called as each state lands, `done` of `total`. */
  onProgress?: (done: number, total: number) => void;
  /** Rasters from an earlier prepare of the same source and edge, reused by state identity. */
  cache?: StateCache | null;
}

/** One state graded, at the decode's density. */
interface Rendered {
  image: ImageBitmap;
  width: number;
  height: number;
  rasters: ReadonlyMap<string, BrushRaster> | null;
  ground: HTMLCanvasElement | null;
}

/** Rasters kept across prepares, keyed by the state object — chapters keep their states' identity. */
export class StateCache {
  private readonly held = new Map<RollPicture, Rendered>();
  constructor(
    readonly file: File,
    readonly raw: File | null,
    readonly edge: number,
  ) {}
  fits(source: TimelapseSource, edge: number): boolean {
    return this.file === source.file && this.raw === (source.raw?.file ?? null) && this.edge === edge;
  }
  get(state: RollPicture): Rendered | undefined {
    return this.held.get(state);
  }
  set(state: RollPicture, r: Rendered): void {
    this.held.set(state, r);
  }
  /** Close everything but `keep`. */
  prune(keep: ReadonlySet<RollPicture>): void {
    for (const [state, r] of this.held) {
      if (keep.has(state)) continue;
      r.image.close();
      this.held.delete(state);
    }
  }
  dispose(): void {
    for (const r of this.held.values()) r.image.close();
    this.held.clear();
  }
}

export interface TimelapsePainter {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Paint frame `t` of `script` onto the canvas. The script may change between calls; its STATES may not. */
  draw(script: TimelapseScript, t: number): void;
  /** Whether every state `script` names is rendered — false for a script whose chapters changed since the prepare. */
  has(script: TimelapseScript): boolean;
  /** The rasters, to hand to the next prepare of the same source. */
  cache: StateCache;
  dispose(): void;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ACCENT = 'rgb(216,70,31)';
const ON_MEDIA = '#f4efe4';
/** How much of the frame the fitted picture may take. */
const FIT_SHARE = 0.94;
const MASK_TINT_EDGE = 160;

// --- rendering the states --------------------------------------------------------

function settingsOf(state: RollPicture, source: TimelapseSource): PassSettings {
  return {
    keystone: state.keystone ?? null,
    lens: state.lens ?? null,
    lensProfile: profileInEffect(state.lensProfile, Boolean(source.raw)),
    layers: state.layers ?? null,
    detail: state.detail ?? null,
    repair: state.repair ?? null,
    vignette: state.vignette ?? null,
    calibration: source.raw ? source.calibration : null,
    aspect: state.aspect,
    framing: state.framing,
  };
}

function needsGpu(state: RollPicture, settings: PassSettings, lut: CubeLut | null): boolean {
  return (
    Boolean(lut) ||
    hasGeometry(settings) ||
    drawingLayers(state.layers).length > 0 ||
    !isDefaultDetail(state.detail) ||
    Boolean(state.vignette?.amount) ||
    (state.repair ?? []).length > 0 ||
    !isSilentTexture(state.grade?.film)
  );
}

/** The state's blurred ground, from a small copy: the feed's idiom, the same at every size. */
function groundOf(image: ImageBitmap): HTMLCanvasElement | null {
  const edge = 48;
  const ratio = image.width / image.height;
  const sw = Math.max(1, Math.round(ratio >= 1 ? edge : edge * ratio));
  const sh = Math.max(1, Math.round(ratio >= 1 ? edge / ratio : edge));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const s = small.getContext('2d', { willReadFrequently: true });
  if (!s) return null;
  s.drawImage(image, 0, 0, sw, sh);
  try {
    const px = s.getImageData(0, 0, sw, sh);
    boxBlurRGBA(px.data, sw, sh, 2);
    s.putImageData(px, 0, 0);
  } catch {
    /* a canvas the page may not read back: the downscale alone is soft */
  }
  return small;
}

/**
 * Every state graded once. The picture is decoded ONCE at `edge` (the
 * sensor through LibRaw where the picture is developed on it), then each
 * state takes its own cube and chain through a grader of its own, disposed
 * as soon as its bitmap is copied out.
 */
async function renderStates(
  states: readonly RollPicture[],
  source: TimelapseSource,
  opts: PrepareOptions,
  cache: StateCache,
): Promise<void> {
  const wanted = states.filter((s) => !cache.get(s));
  if (wanted.length === 0) return;
  const raw = source.raw;
  let src: GradeSource;
  let width: number;
  let height: number;
  let scale: number;
  let bitmap: ImageBitmap | null = null;
  if (raw) {
    const decoded = await decodeRaw(raw.file, { gain: raw.gain, profile: raw.profile, maxEdge: opts.edge, signal: opts.signal, quiet: true, withBytes: false });
    src = decoded.half;
    width = decoded.width;
    height = decoded.height;
    scale = decoded.width / decoded.sourceWidth;
  } else {
    const still = await decodeStill(source.file, { maxEdge: opts.edge });
    bitmap = still.bitmap;
    src = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    scale = bitmap.width / Math.max(1, still.natural.width);
  }
  const ar = width / height;
  try {
    let done = states.length - wanted.length;
    for (const state of wanted) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const develop = raw ? state.develop : state.develop && isRawDevelop(state.develop) ? withoutBase(state.develop) : state.develop;
      const lut = await opts.cubes.cubeFor(state.grade ?? null, isDefaultDevelop(develop) ? null : develop);
      const settings = settingsOf(state, source);
      let image: ImageBitmap;
      let rasters: ReadonlyMap<string, BrushRaster> | null = null;
      if (!raw && bitmap && !needsGpu(state, settings, lut)) {
        image = await createImageBitmap(bitmap);
      } else {
        if (needsSubjectRasters(state.layers)) {
          const geometry = raw ? { ...settings, cameraWarp: source.calibration?.warp ?? null } : settings;
          rasters = await resolveSubjectRasters(state.layers, segmentationView(src, { width, height }, geometry, lut));
        }
        const chain = picturePasses(settings, ar, scale, rasters, Boolean(raw));
        const grader = makeFrameGrader(lut as CubeLut, width, height, 1, chain.passes, chain.pre, state.grade?.film ?? null);
        try {
          image = await createImageBitmap(grader.render(src) as CanvasImageSource);
        } finally {
          grader.dispose();
        }
      }
      cache.set(state, { image, width, height, rasters, ground: groundOf(image) });
      done += 1;
      opts.onProgress?.(done, states.length);
    }
  } finally {
    bitmap?.close();
  }
}

// --- the frame ---------------------------------------------------------------------

interface Fitted {
  /** The delivered box in canvas pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The border layout scaled onto it — the picture's own rect is `x + layout.x …`. */
  layout: BorderLayout;
  ratio: number;
  framing: Framing;
}

/** Where a state's delivered picture sits in the frame: fitted whole, never cover-cropped by the format. */
function fit(state: RollPicture, r: Rendered, W: number, H: number): Fitted {
  const ratio = pictureAspectRatio(state.aspect, r.width, r.height);
  const { layout } = deliveredLayout({ width: r.width, height: r.height }, ratio, state.framing, state.border, null);
  const k = Math.min((W * FIT_SHARE) / Math.max(1, layout.w), (H * FIT_SHARE) / Math.max(1, layout.h));
  const scaled = scaleLayout(layout, k);
  return {
    x: (W - scaled.w) / 2,
    y: (H - scaled.h) / 2,
    w: scaled.w,
    h: scaled.h,
    layout: scaled,
    ratio,
    framing: state.framing ?? DEFAULT_FRAMING,
  };
}

/** A point of the SOURCE picture (fractions) in canvas pixels, through the state's crop. */
function pointOf(f: Fitted, r: Rendered, u: number, v: number): [number, number] {
  const [a, b, c, d, e, g] = frameAffine(r.width, r.height, f.ratio, f.framing);
  const fx = a * u + b * v + c;
  const fy = d * u + e * v + g;
  return [f.x + f.layout.x + fx * f.layout.pw, f.y + f.layout.y + fy * f.layout.ph];
}

/** The camera's transform about its point, applied to the context. */
function applyCamera(ctx: CanvasRenderingContext2D, f: Fitted, r: Rendered, cam: Camera): void {
  if (cam.z <= 1.0001) return;
  const [px, py] = pointOf(f, r, cam.cx, cam.cy);
  ctx.translate(px, py);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-px, -py);
}

function drawGround(ctx: CanvasRenderingContext2D, script: TimelapseScript, r: Rendered, W: number, H: number): void {
  const ground = script.options.ground;
  if (ground === 'paper') ctx.fillStyle = '#f5f1e8';
  else if (ground === 'ink') ctx.fillStyle = '#141210';
  else ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (ground !== 'blur' || !r.ground) return;
  const g = r.ground;
  const k = Math.max(W / g.width, H / g.height) * 1.1;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(g, (W - g.width * k) / 2, (H - g.height * k) / 2, g.width * k, g.height * k);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** The picture `r` drawn in `state`'s frame (its crop, its border), under the camera, at `alpha`. */
function drawPicture(ctx: CanvasRenderingContext2D, f: Fitted, r: Rendered, state: RollPicture, cam: Camera, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.rect(f.x, f.y, f.w, f.h);
  ctx.clip();
  applyCamera(ctx, f, r, cam);
  ctx.translate(f.x, f.y);
  ctx.imageSmoothingQuality = 'high';
  drawDelivered(ctx, r.image, r.width, r.height, f.framing, f.layout, state.border);
  ctx.restore();
}

// --- the crop's figure -------------------------------------------------------------------

/** The four corners of a state's delivered picture in SOURCE pixels, clockwise from the top-left. */
function zoneCorners(f: Fitted, r: Rendered): [number, number][] {
  const { pw, ph } = f.layout;
  return [
    [0, 0],
    [pw, 0],
    [pw, ph],
    [0, ph],
  ].map(([x, y]) => unframePoint(x, y, r.width, r.height, pw, ph, f.framing));
}

/** A source pixel in canvas pixels, through `f`'s own crop. */
function sourceToCanvas(f: Fitted, r: Rendered, sx: number, sy: number): [number, number] {
  const [fx, fy] = framePoint(sx, sy, r.width, r.height, f.layout.pw, f.layout.ph, f.framing);
  return [f.x + f.layout.x + fx, f.y + f.layout.y + fy];
}

/** The veil, the outline and the thirds of a zone growing from `before`'s crop to `after`'s over the before picture. */
function drawCropFigure(ctx: CanvasRenderingContext2D, before: Fitted, rb: Rendered, after: Fitted, ra: Rendered, u: number): void {
  const from = zoneCorners(before, rb);
  const to = zoneCorners(after, ra);
  const pts = from.map(([x0, y0], i) => sourceToCanvas(before, rb, x0 + (to[i][0] - x0) * u, y0 + (to[i][1] - y0) * u));
  const px = before.x + before.layout.x;
  const py = before.y + before.layout.y;
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, before.layout.pw, before.layout.ph);
  ctx.clip();
  // The veil: everything of the picture outside the zone.
  ctx.beginPath();
  ctx.rect(px, py, before.layout.pw, before.layout.ph);
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill('evenodd');
  const lw = Math.max(1, before.layout.pw / 500);
  ctx.strokeStyle = ON_MEDIA;
  ctx.lineWidth = lw * 2;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
  // The thirds: points a third and two thirds along each side.
  const at = (a: [number, number], b: [number, number], s: number): [number, number] => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  ctx.strokeStyle = 'rgba(244,239,228,0.35)';
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (const s of [1 / 3, 2 / 3]) {
    const [x1, y1] = at(pts[0], pts[1], s);
    const [x2, y2] = at(pts[3], pts[2], s);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    const [x3, y3] = at(pts[0], pts[3], s);
    const [x4, y4] = at(pts[1], pts[2], s);
    ctx.moveTo(x3, y3);
    ctx.lineTo(x4, y4);
  }
  ctx.stroke();
  ctx.restore();
}

// --- the tools ---------------------------------------------------------------------

/** The rings of the chapter's patches — dashed, at the destination and the source — fading with `alpha`. */
function drawRepairRings(ctx: CanvasRenderingContext2D, f: Fitted, r: Rendered, state: RollPicture, before: RollPicture, cam: Camera, alpha: number): void {
  const was = new Map((before.repair ?? []).map((p) => [p.id, JSON.stringify(p)] as const));
  const patches = (state.repair ?? []).filter((p) => was.get(p.id) !== JSON.stringify(p));
  const list = patches.length ? patches : (state.repair ?? []);
  if (list.length === 0 || alpha <= 0) return;
  const diag = 0.5 * Math.hypot(f.layout.pw, f.layout.ph) / Math.max(1, f.framing.scale);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.rect(f.x, f.y, f.w, f.h);
  ctx.clip();
  applyCamera(ctx, f, r, cam);
  ctx.strokeStyle = ON_MEDIA;
  ctx.lineWidth = Math.max(1, f.layout.pw / 500) * 2 / cam.z;
  ctx.setLineDash([8 / cam.z, 5 / cam.z]);
  for (const p of list) {
    const [x, y] = pointOf(f, r, p.x, p.y);
    const rad = Math.max(2, p.radius * diag);
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.stroke();
    if (p.dx || p.dy) {
      const [sx, sy] = pointOf(f, r, p.x + p.dx, p.y + p.dy);
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A layer's mask as a tint, at a small resolution, in SOURCE fractions — null where the mask reads the pixels. */
function maskTint(layer: NonNullable<RollPicture['layers']>[number], ar: number, rasters: ReadonlyMap<string, BrushRaster> | null): HTMLCanvasElement | null {
  const mask = layer.mask;
  if (!mask) return null;
  const w = ar >= 1 ? MASK_TINT_EDGE : Math.max(1, Math.round(MASK_TINT_EDGE * ar));
  const h = ar >= 1 ? Math.max(1, Math.round(MASK_TINT_EDGE / ar)) : MASK_TINT_EDGE;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const raster = mask.kind === 'subject' ? (rasters?.get(layer.id) ?? null) : null;
  if (mask.kind === 'subject' && !raster) return null;
  if (mask.kind === 'luma' || mask.kind === 'colour') return null;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      let m: number;
      if (raster) {
        const rx = Math.min(raster.width - 1, Math.floor(u * raster.width));
        const ry = Math.min(raster.height - 1, Math.floor(v * raster.height));
        m = raster.data[ry * raster.width + rx] / 255;
      } else {
        m = maskAt(mask, u, v, 0.5, ar);
      }
      if (layer.invert) m = 1 - m;
      const o = (y * w + x) * 4;
      img.data[o] = 216;
      img.data[o + 1] = 70;
      img.data[o + 2] = 31;
      img.data[o + 3] = Math.round(clamp(m, 0, 1) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function changedLayers(before: RollPicture, after: RollPicture) {
  const was = new Map((before.layers ?? []).map((l) => [l.id, JSON.stringify(l)] as const));
  const changed = (after.layers ?? []).filter((l) => was.get(l.id) !== JSON.stringify(l));
  return changed.length ? changed : (after.layers ?? []);
}

// --- the painter -------------------------------------------------------------------

/** Where the camera is at `t`: travelling from the chapter's `from` to its `to` on out-cubic, zoom geometric. */
function cameraAt(script: TimelapseScript, t: number): Camera {
  const moment = momentAt(script, t);
  if (moment === 'hook') {
    const p = clamp(t / Math.max(0.001, script.hook.dur), 0, 1);
    return { cx: 0.5, cy: 0.5, z: 1 + 0.04 * easeAt('out-expo', p) };
  }
  if (moment === 'ending' || moment === 'done') {
    // The finished picture held: a slow push in, a pull out from close, a drift across, or still.
    const e = script.ending;
    const p = easeAt('in-out-cubic', clamp((t - e.start) / Math.max(0.001, e.dur), 0, 1));
    switch (script.options.ending.motion) {
      case 'push':
        return { cx: 0.5, cy: 0.5, z: 1 + 0.12 * p };
      case 'pull':
        return { cx: 0.5, cy: 0.5, z: 1.12 - 0.12 * p };
      case 'drift':
        return { cx: 0.46 + 0.08 * p, cy: 0.5, z: 1.1 };
      default:
        return { ...WHOLE_PICTURE };
    }
  }
  const c = chapterAt(script, t);
  if (!c) return { ...WHOLE_PICTURE };
  const p = easeAt('out-cubic', clamp((t - c.start) / CAMERA_TRAVEL_SECONDS, 0, 1));
  const { from, to } = c.camera;
  return {
    cx: from.cx + (to.cx - from.cx) * p,
    cy: from.cy + (to.cy - from.cy) * p,
    z: Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * p),
  };
}

/** The share of a chapter's transition done at `t`, eased. */
function transitionAt(c: ScriptChapter, t: number): number {
  return easeAt('in-out-cubic', clamp((t - c.start) / Math.max(0.001, c.dur * TRANSITION_SHARE), 0, 1));
}

/**
 * A corner label over the picture, kept inside `maxWidth`: a word too long
 * for its half of the picture is drawn smaller (down to 60 %), then squeezed
 * by the canvas itself — never run into the other corner's label.
 */
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: CanvasTextAlign, alpha: number, maxWidth: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const font = (px: number) => `600 ${px}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.font = font(size);
  const wide = ctx.measureText(text).width;
  const px = wide > maxWidth ? Math.max(size * 0.6, (size * maxWidth) / wide) : size;
  ctx.font = font(px);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, x + px * 0.06, y + px * 0.06, maxWidth);
  ctx.fillStyle = ON_MEDIA;
  ctx.fillText(text, x, y, maxWidth);
  ctx.restore();
}

/**
 * One frame of a before/after figure: the finished picture whole, the
 * picture as shot over it across `pair.width` from the left at `pair.alpha`,
 * a divider where the figure draws one. The hook and the reveal both paint
 * through here, which is what lets them share their options.
 */
function drawPair(ctx: CanvasRenderingContext2D, f: Fitted, asShot: Rendered, final: Rendered, state: RollPicture, cam: Camera, pair: PairFrame): void {
  drawPicture(ctx, f, final, state, cam);
  if (pair.width <= 0 || pair.alpha <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x, f.y, f.w * pair.width, f.h);
  ctx.clip();
  drawPicture(ctx, f, asShot, state, cam, pair.alpha);
  ctx.restore();
  if (pair.divider) {
    const x = f.x + f.w * pair.width;
    const w = Math.max(2, Math.round(Math.min(f.w, f.h) * 0.004));
    ctx.fillStyle = ON_MEDIA;
    ctx.fillRect(x - w / 2, f.y, w, f.h);
  }
}

/** A figure's progress at `t`: 0 at the moment's start, 1 once it has landed. */
function figureProgress(start: number, turn: number, t: number): number {
  return clamp((t - start) / Math.max(0.001, turn - start), 0, 1);
}

/** The story-style bar along the top: a segment per moment, the one playing filling. */
function drawStories(ctx: CanvasRenderingContext2D, s: TimelapseScript, t: number, W: number, H: number): void {
  const segments = progressSegments(s);
  const pad = Math.round(W * 0.03);
  const gap = Math.max(2, Math.round(W * 0.006));
  const h = Math.max(3, Math.round(H * 0.0035));
  const y = Math.round(H * 0.014);
  const w = (W - pad * 2 - gap * (segments.length - 1)) / segments.length;
  segments.forEach((seg, i) => {
    const x = pad + i * (w + gap);
    const fill = clamp((t - seg.start) / Math.max(0.001, seg.end - seg.start), 0, 1);
    ctx.fillStyle = 'rgba(244,239,228,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = ON_MEDIA;
    ctx.fillRect(x, y, w * fill, h);
  });
}

/**
 * Prepare a painter for `script`'s states over `source`: decode once, grade
 * every state, load the overlay fonts, and hand back `draw`. The states are
 * fixed at this call; the script's words, timing and options may change
 * between draws. A `cache` from a previous prepare of the same source and
 * edge is reused — a hidden chapter or a new length then renders nothing.
 */
export async function prepareTimelapse(script: TimelapseScript, source: TimelapseSource, opts: PrepareOptions): Promise<TimelapsePainter> {
  const cache = opts.cache && opts.cache.fits(source, opts.edge) ? opts.cache : new StateCache(source.file, source.raw?.file ?? null, opts.edge);
  if (opts.cache && opts.cache !== cache) opts.cache.dispose();
  await renderStates(script.states, source, opts, cache);
  cache.prune(new Set(script.states));
  await ensureOverlayFonts(script.overlays, themeFromPreset('neutral'));
  const width = opts.size?.width ?? script.width;
  const height = opts.size?.height ?? script.height;
  const canvas = opts.canvas ?? document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D canvas for the making-of.');
  const theme = themeFromPreset('neutral');
  const ac = ctx;

  const rendered = (state: RollPicture): Rendered => {
    const r = cache.get(state);
    if (!r) throw new Error('A state of the script was not rendered.');
    return r;
  };

  /** The pictures of frame `t` — everything but the words and the clock — onto `g`. */
  const paintScene = (g: CanvasRenderingContext2D, s: TimelapseScript, t: number, W: number, H: number) => {
    const S = Math.min(W, H);
    const moment = momentAt(s, t);
    const asShot = rendered(s.asShot);
    const final = rendered(s.final);
    const finalFit = fit(s.final, final, W, H);

    if (moment === 'hook') {
      const h = s.options.hook;
      const pair = pairAt(h.figure, h.order, h.bounces, figureProgress(0, s.hook.turn, t));
      drawGround(g, s, pair.width > 0.5 && pair.alpha > 0.5 ? asShot : final, W, H);
      drawPair(g, finalFit, asShot, final, s.final, cameraAt(s, t), pair);
    } else if (moment === 'chapter') {
      const c = chapterAt(s, t)!;
      const before = rendered(c.chapter.before);
      const after = rendered(c.chapter.after);
      const fb = fit(c.chapter.before, before, W, H);
      const fa = fit(c.chapter.after, after, W, H);
      const u = transitionAt(c, t);
      const cam = cameraAt(s, t);
      drawGround(g, s, u < 0.5 ? before : after, W, H);
      const crops = c.chapter.sections.includes('crop');
      if (crops && u < 1) {
        drawPicture(g, fb, before, c.chapter.before, cam);
        if (s.options.overlays.tools) drawCropFigure(g, fb, before, fa, after, u);
      } else if (u >= 1) {
        drawPicture(g, fa, after, c.chapter.after, cam);
      } else {
        drawPicture(g, fb, before, c.chapter.before, cam);
        drawPicture(g, fa, after, c.chapter.after, cam, u);
      }
      if (s.options.overlays.tools) {
        // The tools: shown whole through the first quarter, gone by the end of the transition.
        const hold = clamp((t - c.start) / Math.max(0.001, c.dur * TRANSITION_SHARE), 0, 1);
        const toolAlpha = hold < 0.5 ? 1 : 1 - (hold - 0.5) / 0.5;
        if (c.chapter.section === 'repair') drawRepairRings(g, fa, after, c.chapter.after, c.chapter.before, cam, toolAlpha);
        if (c.chapter.section === 'layers' && toolAlpha > 0) {
          const ar = after.width / after.height;
          for (const layer of changedLayers(c.chapter.before, c.chapter.after)) {
            const tint = maskTint(layer, ar, after.rasters);
            if (!tint) continue;
            g.save();
            g.globalAlpha = toolAlpha * 0.4;
            g.beginPath();
            g.rect(fa.x, fa.y, fa.w, fa.h);
            g.clip();
            applyCamera(g, fa, after, cam);
            g.translate(fa.x, fa.y);
            drawPictureIn(g, tint, tint.width, tint.height, fa.framing, fa.layout);
            g.restore();
          }
        }
      }
    } else if (moment === 'reveal') {
      // The reveal: the same figures as the hook, on the whole picture, with BEFORE / AFTER in the corners.
      const r = s.options.reveal;
      const pair = pairAt(r.figure, r.order, r.bounces, figureProgress(s.reveal.start, s.reveal.turn, t));
      drawGround(g, s, final, W, H);
      drawPair(g, finalFit, asShot, final, s.final, WHOLE_PICTURE, pair);
      if (s.options.overlays.captions && t < s.reveal.turn) {
        const R = finalFit;
        const label = Math.round(S * 0.032);
        const inset = Math.round(S * 0.03);
        const half = Math.max(1, R.w / 2 - inset * 1.5);
        // Side by side, both are named; one over the other, the one on screen is.
        const both = pair.divider;
        const beforeOn = pair.width > 0.02 && pair.alpha > 0.5;
        const showBefore = both ? pair.width > 0.02 : beforeOn && pair.width >= 0.98;
        const showAfter = both ? pair.width < 0.98 : !(beforeOn && pair.width >= 0.98);
        if (showBefore) drawLabel(g, s.options.words.before, R.x + inset, R.y + inset + label, label, 'left', 1, half);
        if (showAfter) drawLabel(g, s.options.words.afterLabel, R.x + R.w - inset, R.y + inset + label, label, 'right', 1, half);
      }
    } else {
      // The ending: the finished picture alone, moving slowly.
      drawGround(g, s, final, W, H);
      drawPicture(g, finalFit, final, s.final, cameraAt(s, t));
    }
  };

  // The loop's target, the video's first frame, painted once per script and size.
  let firstFrame: { script: TimelapseScript; canvas: HTMLCanvasElement } | null = null;
  const firstFrameOf = (s: TimelapseScript, W: number, H: number): HTMLCanvasElement | null => {
    if (firstFrame && firstFrame.script === s && firstFrame.canvas.width === W && firstFrame.canvas.height === H) return firstFrame.canvas;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;
    paintScene(g, s, 0, W, H);
    firstFrame = { script: s, canvas: c };
    return c;
  };

  const draw = (s: TimelapseScript, t: number) => {
    const W = canvas.width;
    const H = canvas.height;
    ac.setTransform(1, 0, 0, 1, 0, 0);
    ac.clearRect(0, 0, W, H);
    paintScene(ac, s, Math.min(t, Math.max(0, s.seconds - 1e-3)), W, H);
    // A loop's last half-second fades into the first frame, so the feed's replay has no seam.
    if (s.options.ending.loop && t > s.seconds - LOOP_SECONDS) {
      const first = firstFrameOf(s, W, H);
      if (first) {
        ac.save();
        ac.globalAlpha = easeAt('in-out-cubic', clamp((t - (s.seconds - LOOP_SECONDS)) / LOOP_SECONDS, 0, 1));
        ac.drawImage(first, 0, 0);
        ac.restore();
      }
    }

    // The captions, the counter, the words, the plate and the credit — the engine's.
    drawOverlays(ac, s.overlays, null, W, H, { timeSeconds: t, theme });
    if (s.options.progress === 'stories') {
      drawStories(ac, s, t, W, H);
    } else if (s.options.progress === 'line') {
      // The clock along the bottom edge: the suite's hairline as the video's own.
      const bar = Math.max(2, Math.round(H * 0.003));
      ac.fillStyle = 'rgba(244,239,228,0.25)';
      ac.fillRect(0, H - bar, W, bar);
      ac.fillStyle = ACCENT;
      ac.fillRect(0, H - bar, W * clamp(t / Math.max(0.001, s.seconds), 0, 1), bar);
    }
  };

  return {
    canvas,
    width,
    height,
    draw,
    has: (s) => s.states.every((state) => cache.get(state) !== undefined),
    cache,
    dispose: () => cache.dispose(),
  };
}
