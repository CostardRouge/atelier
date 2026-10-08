/**
 * «&nbsp;Vitrine&nbsp;» — the drawing: one frame of a recipe, into the 2D
 * context every opener paints into.
 *
 * The order, back to front: the sky (or a studio's cove, or a drawing
 * office's grid); a diorama's slab; the ground's flat polygons, cut at the
 * horizon; what reflects — the same world rendered again from under the
 * ground into a third-size canvas, which is what makes it soft; the vehicle's
 * shadow and its beams; the far objects; then ONE sort of the near objects
 * and the vehicle together (`mesh3d.renderOrder`), so a tree really passes in
 * front of it; then the glows, the effects, the weather, the light sweep's
 * veil and, for a riso, the print made of all of it.
 *
 * The frame is a 360-wide space whatever the output's size, its height the
 * output's shape: the lab was designed on 360 × 640 and every distance in it
 * is a share of that. A frame wider than a phone's draws the camera closer
 * in, never off its edges.
 *
 * Browser-bound (canvases for the reflection and the riso), so it is not
 * unit-tested; `showcase-plan.ts` is.
 */

import type { CarSpec } from '../car-spec';
import type { FrameBox, HookCtx2D } from './hook-variant';
import {
  box as boxPart,
  dot,
  extrude as extrudePart,
  hullSolid as hullPart,
  normalise,
  paintGroundShadow,
  project,
  renderOrder,
  toWorld,
  viewDirection,
  type Light,
  type Part,
  type Pose,
  type RenderedFace,
  type Vec3,
} from './mesh3d';
import {
  BASE_HORIZON,
  BASE_OY,
  BASE_SCALE,
  DIORAMA,
  DIORAMA_RISE,
  carState,
  eBack,
  endOf,
  horizonDistance,
  moveObj,
  orbitAt,
  placeOf,
  sceneOf,
  showcaseCar,
  tileOffsets,
  trajectory,
  type CarState,
  type EndId,
  type ShowcaseCar,
  type ShowcaseOptions,
  type PlaceScene,
} from './showcase-plan';
import {
  EMISSIVE,
  FIRE,
  INDOOR,
  PROP_RGB,
  SHARED_RGB,
  TAU,
  TIMES,
  WEATHERS,
  clamp,
  eOut,
  lerp,
  mix,
  movedTower,
  mul,
  rgbOf,
  rng,
  seg,
  type Rgb,
  type SceneDraw,
  type SceneObj,
  type ShowcasePlace,
  type TimeLook,
  type Tower,
  type WeatherLook,
} from './showcase-scenes';

/** The frame's width, in the units the scenes are designed in. */
const V = 360;
const PLAN_BG: Rgb = [13, 38, 69];
const LN = (a: number) => `rgba(206,228,255,${a})`;
const PINK: Rgb = [255, 72, 176];
const BLUE: Rgb = [50, 85, 164];
const css = (c: Rgb, a = 1) => `rgba(${clamp(c[0], 0, 255) | 0},${clamp(c[1], 0, 255) | 0},${clamp(c[2], 0, 255) | 0},${a})`;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function scratchCanvas(w: number, h: number): { c: AnyCanvas; g: AnyCtx } | null {
  const c: AnyCanvas | null =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : typeof document !== 'undefined'
        ? Object.assign(document.createElement('canvas'), { width: w, height: h })
        : null;
  const g = c?.getContext('2d', { willReadFrequently: true }) as AnyCtx | null | undefined;
  return c && g ? { c, g } : null;
}

/** Everything a recipe is drawn from, worked out once when the opener is prepared. */
export interface ShowcasePrepared {
  o: ShowcaseOptions;
  place: ShowcasePlace;
  variant: string;
  end: EndId;
  car: ShowcaseCar;
  scene: PlaceScene;
  T: TimeLook;
  W: WeatherLook;
  indoor: boolean;
  diorama: boolean;
  rgb: Readonly<Record<string, Rgb>>;
  /** A studio's cove, inner and outer. */
  cove: { inner: string; outer: string } | null;
  /** The reflection's and the riso's canvases, made on the first frame that needs them. */
  scratch: { refl?: { c: AnyCanvas; g: AnyCtx }; rs?: { c: AnyCanvas; g: AnyCtx }; grain?: CanvasPattern | null };
}

export function prepareShowcase(o: ShowcaseOptions, spec: CarSpec): ShowcasePrepared {
  const { place, variant } = placeOf(o);
  const studio = place.studio?.(variant) ?? null;
  const indoor = place.indoor?.(variant) ?? false;
  const T = studio ? studio.light : indoor ? INDOOR : TIMES[o.time];
  const rgb: Record<string, Rgb> = { ...SHARED_RGB };
  for (const [k, v] of Object.entries(place.pal ?? {})) rgb[k] = rgbOf(v);
  const diorama = o.frame === 'diorama';
  return {
    o,
    place,
    variant,
    end: endOf(place, variant, o.end),
    car: showcaseCar(spec),
    scene: sceneOf(place, variant, diorama),
    T,
    W: WEATHERS[o.weather],
    indoor,
    diorama,
    rgb,
    cove: studio ? { inner: studio.inner, outer: studio.outer } : null,
    scratch: {},
  };
}

/** One frame being drawn — into the output, or into the reflection under it. */
interface Pass {
  g: AnyCtx;
  t: number;
  prep: ShowcasePrepared;
  pose: Pose;
  view: Vec3;
  mirror: boolean;
  /** Depth of the point the camera looks at: the haze is measured from it. */
  d0: number;
  /** The horizon, metres beyond the camera's point, and where it sits on screen. */
  hz: number | null;
  hy: number | null;
  /** The colour the ground melts into at the horizon. */
  hc: Rgb;
  box: { W: number; D: number; cx: number; cy: number } | null;
  Y0: number;
  cam: [number, number];
  campOn: boolean;
  campAt: number | null;
  VH: number;
  light: Light;
  style: ShowcaseOptions['look'];
  car: CarState | null;
}

const P = (f: Pass, v: Vec3) => project(toWorld(v, f.pose), f.pose);

function fogOf(f: Pass, depth: number): number {
  const W = f.prep.W;
  return W.fog * clamp((depth - f.d0 - W.start) / W.range);
}
function grade(f: Pass, c: Rgb, depth: number, emissive: boolean): Rgb {
  const T = f.prep.T;
  let o = emissive ? mix(c, mul(c, T.tint), 1 - T.lamps) : mul(c, T.tint);
  if (f.prep.W.wet && !emissive) o = [o[0] * 0.86, o[1] * 0.88, o[2] * 0.92];
  const k = fogOf(f, depth);
  return k > 0 ? mix(o, T.fog, k) : o;
}

/** A polygon's part inside a rectangle of the ground. */
function clipRect(poly: readonly Vec3[], W: number, D: number, cx: number, cy: number): Vec3[] {
  let out: Vec3[] = [...poly];
  const x0 = cx - W;
  const x1 = cx + W;
  const y0 = cy - D;
  const y1 = cy + D;
  const edges: [(p: Vec3) => boolean, (a: Vec3, b: Vec3) => number][] = [
    [(p) => p[0] >= x0, (a, b) => (x0 - a[0]) / (b[0] - a[0])],
    [(p) => p[0] <= x1, (a, b) => (x1 - a[0]) / (b[0] - a[0])],
    [(p) => p[1] >= y0, (a, b) => (y0 - a[1]) / (b[1] - a[1])],
    [(p) => p[1] <= y1, (a, b) => (y1 - a[1]) / (b[1] - a[1])],
  ];
  for (const [inside, tAt] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i];
      const b = inp[(i + 1) % inp.length];
      const ia = inside(a);
      if (ia) out.push(a);
      if (ia !== inside(b)) {
        const t = tAt(a, b);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    if (!out.length) break;
  }
  return out;
}
/** A polygon's part on the near side of the horizon. */
function clipHz(vs: readonly Vec3[], pose: Pose, limit: number): Vec3[] {
  const f = (v: Vec3) => toWorld(v, pose)[1] - limit;
  const out: Vec3[] = [];
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if (fa <= 0 !== fb <= 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}
function trace(g: AnyCtx, pts: readonly { x: number; y: number }[]) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}
function perim(pts: readonly { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

function glow(f: Pass, x: number, y: number, r: number, col: Rgb, a: number) {
  if (f.style === 'blueprint' || a <= 0.01) return;
  const g = f.g;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, css(col, a));
  gr.addColorStop(0.2, css(col, a * 0.45));
  gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
  g.restore();
}
function spot(f: Pass, x: number, y: number, r: number, col: Rgb, a: number, warm?: boolean) {
  if (f.style === 'blueprint' || a <= 0) return;
  const g = f.g;
  g.save();
  g.translate(x, y);
  g.scale(1, Math.sin(f.pose.tilt) * 0.9);
  g.translate(-x, -y);
  if (warm) g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, css(col, a));
  gr.addColorStop(1, css(col, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, 2 * r, 2 * r);
  g.restore();
}

/** The ground's drawing words, for a place's `ground`. */
function sceneDraw(f: Pass): SceneDraw {
  return {
    t: f.t,
    variant: f.prep.variant,
    cam: f.cam,
    T: f.prep.T,
    W: f.prep.W,
    campOn: f.campOn,
    P: (v) => P(f, v),
    sea: () => mul([44, 112, 146], f.prep.T.tint),
    lake: () => mul([52, 104, 120], f.prep.T.tint),
    poly(verts, col, o = {}) {
      let vs: Vec3[] = verts.map((v) => [v[0], v[1], v[2] ?? 0] as Vec3);
      if (f.box) {
        vs = clipRect(vs, f.box.W, f.box.D, f.box.cx, f.box.cy);
        if (vs.length < 3) return;
      }
      if (f.hz !== null) {
        vs = clipHz(vs, f.pose, f.hz + f.Y0);
        if (vs.length < 3) return;
      }
      const pts = vs.map((v) => P(f, v));
      const g = f.g;
      trace(g, pts);
      if (f.style === 'blueprint') {
        if ((o.a ?? 1) >= 0.99) {
          g.fillStyle = css(PLAN_BG);
          g.fill();
        }
        g.strokeStyle = LN(o.water ? 0.25 : 0.45);
        g.lineWidth = 0.5;
        g.stroke();
        return;
      }
      const d = pts.reduce((s, p) => s + p.depth, 0) / pts.length;
      g.fillStyle = css(grade(f, col, d, false), o.a ?? 1);
      g.fill();
    },
    line(verts, col, a, w) {
      if (f.style === 'blueprint') return;
      const vs = f.box ? verts.filter((v) => Math.abs(v[0] - f.box!.cx) < f.box!.W && Math.abs(v[1] - f.box!.cy) < f.box!.D) : verts;
      if (vs.length < 2) return;
      const pts = vs.map((v) => P(f, v));
      const g = f.g;
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.strokeStyle = css(grade(f, col, pts[0].depth, true), a);
      g.lineWidth = w;
      g.stroke();
    },
    spot: (x, y, r, col, a, warm) => spot(f, x, y, r, col, a, warm),
    groundText(text, x, y, size, col, a) {
      if (f.box && (Math.abs(x - f.box.cx) > f.box.W || Math.abs(y - f.box.cy) > f.box.D)) return;
      const o = P(f, [x, y, 0]);
      const ex = P(f, [x + 1, y, 0]);
      const ey = P(f, [x, y + 1, 0]);
      const g = f.g;
      g.save();
      g.transform(ex.x - o.x, ex.y - o.y, -(ey.x - o.x), -(ey.y - o.y), o.x, o.y);
      g.font = `700 ${size}px "Space Grotesk", "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = f.style === 'blueprint' ? LN(0.5) : css(grade(f, col, o.depth, false), a);
      g.fillText(text, 0, 0);
      g.restore();
    },
  };
}

/** Faces from one sort: the scene's (`s|role`) and the vehicle's (`c<i>|role`). */
function paintFaces(f: Pass, faces: readonly RenderedFace[], car: CarState | null, haze = 0) {
  const g = f.g;
  const blueprint = f.style === 'blueprint';
  const T = f.prep.T;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const face of faces) {
    const pts = face.points;
    if (pts.length < 3) continue;
    const k = face.role.indexOf('|');
    const tg = face.role.slice(0, k);
    const role = face.role.slice(k + 1);
    const isCar = tg[0] === 'c';
    let a = 1;
    let lp = 1;
    let fa = 1;
    let bst = 0;
    if (isCar && car) {
      const i = +tg.slice(1);
      a = car.alpha[i];
      lp = car.lineP[i];
      fa = car.fillA;
      bst = car.boost[i];
    }
    if (a <= 0.003) continue;
    g.globalAlpha = a;
    trace(g, pts);
    if (blueprint) {
      g.fillStyle = css(PLAN_BG, isCar && lp < 1 ? Math.min(1, lp * 1.8) : 1);
      g.fill();
      const per = perim(pts);
      g.setLineDash(lp < 1 ? [per * eOut(lp), per + 1] : []);
      g.strokeStyle = LN(isCar ? 0.92 : 0.55);
      g.lineWidth = isCar ? 0.75 : 0.5;
      g.stroke();
      g.setLineDash([]);
      continue;
    }
    const base = (isCar ? f.prep.car.rgb[role] : f.prep.rgb[role] ?? PROP_RGB[role]) ?? [128, 128, 128];
    const em = EMISSIVE.has(role);
    const h = face.highlight + bst;
    let c: Rgb = em ? base : [base[0] * face.shade + T.hl[0] * h, base[1] * face.shade + T.hl[1] * h, base[2] * face.shade + T.hl[2] * h];
    // A window by day is glass, not light.
    if (em && role === 'e-win' && T.lamps < 0.2) c = mix(base, [92, 118, 140], 0.85);
    c = grade(f, c, face.depth, em && T.lamps > 0.2);
    if (haze) c = mix(c, f.hc, haze);
    const col = css(c);
    if (isCar && fa < 1) {
      if (fa > 0) {
        g.globalAlpha = a * fa;
        g.fillStyle = col;
        g.fill();
        g.globalAlpha = a;
      }
      const per = perim(pts);
      g.setLineDash(lp < 1 ? [per * eOut(lp), per + 1] : []);
      g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - fa * 0.85)})`;
      g.lineWidth = 0.8;
      g.stroke();
      g.setLineDash([]);
      continue;
    }
    g.fillStyle = col;
    g.fill();
    const inked = face.outline && (isCar || !em);
    g.strokeStyle = inked ? (isCar ? T.ink : css(mix(c, [0, 0, 0], 0.55))) : col;
    g.lineWidth = inked ? (isCar ? 0.8 : 0.5) : 0.6;
    g.stroke();
  }
  g.globalAlpha = 1;
}

function sky(f: Pass) {
  const g = f.g;
  const VH = f.VH;
  if (f.style === 'blueprint') {
    g.fillStyle = css(PLAN_BG);
    g.fillRect(0, 0, V, VH);
    g.lineWidth = 0.5;
    for (let x = 0; x <= V; x += 12) {
      g.strokeStyle = LN(x % 60 === 0 ? 0.14 : 0.05);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, VH);
      g.stroke();
    }
    for (let y = 0; y <= VH; y += 12) {
      g.strokeStyle = LN(y % 60 === 0 ? 0.14 : 0.05);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(V, y);
      g.stroke();
    }
    return;
  }
  const cove = f.prep.cove;
  if (cove) {
    const gr = g.createRadialGradient(180, VH * 0.52, 30, 180, VH * 0.52, Math.max(V, VH) * 0.75);
    gr.addColorStop(0, cove.inner);
    gr.addColorStop(1, cove.outer);
    g.fillStyle = gr;
    g.fillRect(0, 0, V, VH);
    return;
  }
  const T = f.prep.T;
  if (!T.sky) {
    g.fillStyle = css(T.fog);
    g.fillRect(0, 0, V, VH);
    return;
  }
  const gr = g.createLinearGradient(0, 0, 0, f.hy ?? VH * 0.62);
  gr.addColorStop(0, T.sky[0]);
  gr.addColorStop(0.55, T.sky[1]);
  gr.addColorStop(1, T.sky[2]);
  g.fillStyle = gr;
  g.fillRect(0, 0, V, VH);
  if (T.stars) {
    const r = rng(5);
    for (let i = 0; i < 46; i++) {
      const x = r() * V;
      const y = r() * VH * 0.4;
      g.fillStyle = `rgba(255,248,236,${T.stars * (0.25 + 0.5 * r()) * (0.6 + 0.4 * Math.sin(f.t * 2 + i))})`;
      g.fillRect(x, y, 1.2, 1.2);
    }
  }
  if (T.sun) {
    const s = T.sun;
    const y = f.hy !== null ? f.hy - 6 : VH * 0.47;
    const R = s.r * 3.4;
    const gr2 = g.createRadialGradient(s.x, y, 0, s.x, y, R);
    gr2.addColorStop(0, css(s.c, 0.95));
    gr2.addColorStop(0.3, css(s.c, 0.85));
    gr2.addColorStop(0.33, css(s.c, 0.3));
    gr2.addColorStop(1, css(s.c, 0));
    g.fillStyle = gr2;
    g.fillRect(s.x - R, y - R, 2 * R, 2 * R);
  }
  if (T.moon && T.sky) {
    const m = T.moon;
    glow(f, m.x, m.y, 60, [190, 205, 255], 0.25);
    g.fillStyle = '#eef0f8';
    g.beginPath();
    g.arc(m.x, m.y, m.r, 0, TAU);
    g.fill();
    g.fillStyle = css(rgbOf(T.sky[0]));
    g.beginPath();
    g.arc(m.x + 5, m.y - 3, m.r, 0, TAU);
    g.fill();
  }
}

const tagged = (p: Part): Part => ({ ...p, faces: p.faces.map((fc) => ({ role: 's|' + fc.role, verts: fc.verts })) });

/** The diorama's slab: the place's strata, a floating shadow far below. */
function slab(f: Pass, rgb: Record<string, Rgb>, oyBase: number) {
  const box = f.box!;
  const place = f.prep.place;
  const st = place.strataFor?.(f.prep.variant) ?? place.strata;
  const plan = [[-box.W, -box.D], [box.W, -box.D], [box.W, box.D], [-box.W, box.D]].map(([x, y]) => [x + box.cx, y + box.cy] as const);
  const deep = [[-box.W + 1.8, -box.D + 1.2], [box.W - 1.4, -box.D + 1.0], [box.W - 2, box.D - 1.3], [-box.W + 1.3, box.D - 1.1]].map(([x, y]) => [x + box.cx, y + box.cy, -3.4] as Vec3);
  const parts = [
    tagged(extrudePart('a', plan, -0.35, 0, { side: 'sl0', top: 'sl0', bottom: null })),
    tagged(extrudePart('b', plan, -1.0, -0.35, { side: 'sl1', top: null, bottom: null })),
    tagged(extrudePart('c', plan, -1.8, -1.0, { side: 'sl2', top: null, bottom: null })),
    tagged(hullPart('d', [...plan.map(([x, y]) => [x, y, -1.8] as Vec3), ...deep], (n) => (n[2] > 0.5 ? null : 'sl3'))),
  ];
  rgb.sl0 = rgbOf(st[0]);
  rgb.sl1 = rgbOf(st[1]);
  rgb.sl2 = rgbOf(st[2]);
  rgb.sl3 = mix(rgbOf(st[2]), [30, 20, 20], 0.35);
  const g = f.g;
  g.save();
  g.translate(180, oyBase + 150 * (f.VH / 640));
  g.scale(1, 0.18);
  g.fillStyle = 'rgba(40,20,30,.18)';
  g.beginPath();
  g.arc(0, 0, 130, 0, TAU);
  g.fill();
  g.restore();
  paintFaces({ ...f, prep: { ...f.prep, rgb } }, renderOrder(parts, f.pose, { ...f.light, ambient: 0.5, key: normalise([-0.5, -0.42, 0.75]) }), null);
}

function drawTower(f: Pass, tw: Tower, rise: number) {
  const h = tw.h * rise;
  if (h < 0.05) return;
  const part = tagged(boxPart('tower', [tw.x - tw.w / 2, tw.y - tw.d / 2, 0], [tw.x + tw.w / 2, tw.y + tw.d / 2, h], 'tower'));
  const faces = renderOrder([part], f.pose, f.light);
  const g = f.g;
  const blueprint = f.style === 'blueprint';
  const base = tw.low ? mix([120, 104, 96], [150, 128, 110], tw.tone) : mix([60, 64, 92], [90, 96, 128], tw.tone);
  for (const face of faces) {
    trace(g, face.points);
    if (blueprint) {
      g.fillStyle = css(PLAN_BG);
      g.fill();
      g.strokeStyle = LN(0.5);
      g.lineWidth = 0.5;
      g.stroke();
      continue;
    }
    const c = grade(f, [base[0] * face.shade + 60 * face.highlight, base[1] * face.shade + 60 * face.highlight, base[2] * face.shade + 70 * face.highlight], face.depth, false);
    g.fillStyle = css(c);
    g.fill();
    g.strokeStyle = css(c);
    g.lineWidth = 0.6;
    g.stroke();
  }
  const lit = f.prep.T.lamps;
  const fog = fogOf(f, P(f, [tw.x, tw.y, 0]).depth);
  const warm = new Path2D();
  const cool = new Path2D();
  const dim = new Path2D();
  let any = false;
  for (let fi = 0; fi < 4; fi++) {
    const fc = tw.faces[fi];
    if (dot(toWorld(fc.n, f.pose), f.view) >= 0) continue;
    for (const wd of tw.win) {
      if (wd.fi !== fi || wd.z + 0.3 > h) continue;
      const on = lit > 0.2 ? seg(f.t, wd.on, wd.on + 0.08) : 0;
      const cx = fc.o[0] + fc.t[0] * wd.a + fc.n[0] * 0.02;
      const cy = fc.o[1] + fc.t[1] * wd.a + fc.n[1] * 0.02;
      const cs = [[-0.22, -0.28], [0.22, -0.28], [0.22, 0.28], [-0.22, 0.28]].map(([u, v]) => P(f, [cx + fc.t[0] * u, cy + fc.t[1] * u, wd.z + v]));
      const path = on > 0.5 ? (wd.warm ? warm : cool) : dim;
      path.moveTo(cs[0].x, cs[0].y);
      for (let i = 1; i < 4; i++) path.lineTo(cs[i].x, cs[i].y);
      path.closePath();
      any = true;
    }
  }
  if (any) {
    if (blueprint) {
      g.strokeStyle = LN(0.35);
      g.lineWidth = 0.4;
      g.stroke(warm);
      g.stroke(cool);
      g.stroke(dim);
    } else {
      g.fillStyle = css(mix([86, 104, 128], f.prep.T.fog, fog), 0.7);
      g.fill(dim);
      g.fillStyle = `rgba(255,196,118,${0.92 * (1 - fog * 0.7) * lit})`;
      g.fill(warm);
      g.fillStyle = `rgba(150,214,255,${0.88 * (1 - fog * 0.7) * lit})`;
      g.fill(cool);
    }
  }
  if (tw.low && tw.neon && lit > 0.2 && !blueprint && rise > 0.95) {
    const p = P(f, [tw.x, tw.y - tw.d / 2 - 0.05, Math.min(h - 0.4, 2.6)]);
    glow(f, p.x, p.y, 26, tw.neonC, 0.8 * lit * (0.85 + 0.15 * Math.sin(f.t * 9 + tw.x)));
    g.fillStyle = css(mix(tw.neonC, [255, 255, 255], 0.5));
    g.fillRect(p.x - 7, p.y - 1.5, 14, 3);
  }
}

function gulls(f: Pass) {
  if (f.style === 'blueprint') return;
  const g = f.g;
  g.strokeStyle = f.prep.T.lamps > 0.9 ? 'rgba(220,226,240,.7)' : 'rgba(40,40,50,.75)';
  g.lineWidth = 1.1;
  for (let k = 0; k < 4; k++) {
    const x = ((f.t * (16 + k * 5) + k * 97) % 440) - 40;
    const y = f.VH * 0.19 + k * 34 + Math.sin(f.t * 1.3 + k) * 8;
    const w = 6 + k;
    const flap = Math.sin(f.t * 9 + k * 2) * 3;
    g.beginPath();
    g.moveTo(x - w, y - flap);
    g.quadraticCurveTo(x - w / 2, y - 3 - flap / 2, x, y);
    g.quadraticCurveTo(x + w / 2, y - 3 - flap / 2, x + w, y - flap);
    g.stroke();
  }
}

function fireFx(f: Pass) {
  const [x, y] = FIRE;
  if (f.style === 'blueprint' || !f.campOn) return;
  if (f.box && (Math.abs(x - f.box.cx) > f.box.W || Math.abs(y - f.box.cy) > f.box.D)) return;
  const at = seg(f.t, 0.6, 1.2) * (f.campAt !== null ? seg(f.t, f.campAt, f.campAt + 0.5) : 1);
  if (at <= 0) return;
  const p = P(f, [x, y, 0.2]);
  const g = f.g;
  const sc = f.pose.scale / BASE_SCALE;
  glow(f, p.x, p.y - 8 * sc, 90 * sc, [255, 140, 60], (0.35 + 0.35 * f.prep.T.lamps) * at);
  g.save();
  g.globalCompositeOperation = 'lighter';
  const fills = ['rgba(255,110,40,.85)', 'rgba(255,180,70,.85)', 'rgba(255,240,180,.9)'];
  for (let k = 0; k < 3; k++) {
    const fl = 1 + 0.25 * Math.sin(f.t * (11 + k * 3) + k);
    const hgt = (16 - k * 4) * fl * sc * at;
    const w = (7 - k * 1.6) * sc;
    g.fillStyle = fills[k];
    g.beginPath();
    g.moveTo(p.x - w, p.y);
    g.quadraticCurveTo(p.x - w * 0.6, p.y - hgt * 0.6, p.x + Math.sin(f.t * 7 + k) * 2, p.y - hgt);
    g.quadraticCurveTo(p.x + w * 0.6, p.y - hgt * 0.6, p.x + w, p.y);
    g.closePath();
    g.fill();
  }
  for (let k = 0; k < 10; k++) {
    const ph = (f.t * 0.7 + k / 10) % 1;
    g.fillStyle = `rgba(255,190,90,${(1 - ph) * 0.9})`;
    g.fillRect(p.x + Math.sin(k * 3.1 + f.t * 2) * 8 * sc, p.y - ph * 70 * sc, 1.4, 1.4);
  }
  g.restore();
}

function weatherFx(f: Pass) {
  if (f.style === 'blueprint') return;
  const g = f.g;
  const W = f.prep.W;
  const VH = f.VH;
  if (W.wet && !f.prep.indoor) {
    g.strokeStyle = f.prep.T.lamps > 0.6 ? 'rgba(200,210,240,.35)' : 'rgba(255,255,255,.4)';
    g.lineWidth = 0.7;
    const r = rng(77);
    g.beginPath();
    for (let k = 0; k < 140; k++) {
      const x0 = r() * (V + 80) - 40;
      const sp = 700 + r() * 300;
      const y = ((r() * VH + f.t * sp) % (VH + 40)) - 20;
      g.moveTo(x0 - y * 0.12, y);
      g.lineTo(x0 - y * 0.12 - 2.2, y + 11);
    }
    g.stroke();
  }
  if (W.mist) {
    const gr = g.createLinearGradient(0, VH * 0.19, 0, VH * 0.81);
    gr.addColorStop(0, css(f.prep.T.fog, 0));
    gr.addColorStop(0.45, css(f.prep.T.fog, 0.32));
    gr.addColorStop(1, css(f.prep.T.fog, 0.05));
    g.fillStyle = gr;
    g.fillRect(0, 0, V, VH);
    // Shafts of light through a misty forest.
    if (f.prep.place.id === 'forest' && f.prep.T.lamps < 0.9) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 5; k++) {
        const x = 40 + k * 70 + Math.sin(f.t * 0.3 + k) * 10;
        const gr2 = g.createLinearGradient(x, 0, x - 120, VH);
        gr2.addColorStop(0, 'rgba(255,240,200,.16)');
        gr2.addColorStop(1, 'rgba(255,240,200,0)');
        g.fillStyle = gr2;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 16, 0);
        g.lineTo(x - 104, VH);
        g.lineTo(x - 150, VH);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
  }
}

/** The headlights' beams on the ground, or their glows, the indicator and the brake lights. */
function lights(f: Pass, car: CarState, pass: 'ground' | 'glow') {
  if (f.style === 'blueprint') return;
  const prep = f.prep;
  const on = Math.max(prep.T.lamps, prep.W.mist ? 0.5 : 0, prep.indoor ? 0.4 : 0);
  const vc = prep.car;
  const yF = vc.box.y1 - 0.05;
  const g = f.g;
  const sc = f.pose.scale / BASE_SCALE;
  if (pass === 'ground') {
    if (on < 0.3 || car.alpha.every((a) => a < 0.9)) return;
    const A = P(f, car.R([0, yF, 0.02]));
    const Bp = P(f, car.R([0, yF + 11, 0.02]));
    const gr = g.createLinearGradient(A.x, A.y, Bp.x, Bp.y);
    gr.addColorStop(0, `rgba(255,236,196,${0.4 * on})`);
    gr.addColorStop(1, 'rgba(255,236,196,0)');
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gr;
    trace(g, ([[-0.7, yF], [0.7, yF], [3.4, yF + 11], [-3.4, yF + 11]] as const).map(([x, y]) => P(f, car.R([x, y, 0.02]))));
    g.fill();
    g.restore();
    return;
  }
  const nose = toWorld(toWorld([0, 1, 0], { fx: Math.sin(car.h), fy: Math.cos(car.h) }), f.pose);
  const front = dot(nose, f.view) < 0;
  const tr = f.prep.end !== 'still' ? trajectory(prep.place, prep.variant, prep.end, f.t) : null;
  if (tr?.blink && f.t > tr.blink.from && f.t < tr.blink.to && Math.floor(f.t * 3) % 2 === 0) {
    const sx = tr.blink.side * (vc.wid / 2 - 0.12);
    const p = P(f, car.R(front ? [sx, vc.box.y1 - 0.2, 0.9] : [sx, vc.box.y0 + 0.2, 0.95]));
    glow(f, p.x, p.y, 15 * sc, [255, 170, 40], 0.95);
  }
  if (tr?.braking && !front) {
    for (const s of [-1, 1]) {
      const p = P(f, car.R([s * vc.wid * 0.33, vc.box.y0 + 0.3, 0.9]));
      glow(f, p.x, p.y, 16 * sc, [255, 30, 30], 0.9);
    }
  }
  if (on < 0.3 || car.alpha.every((a) => a < 0.9)) return;
  for (const s of [-1, 1]) {
    if (front) {
      const p = P(f, car.R([s * vc.wid * 0.29, vc.box.y1 - 0.28, vc.model.wheelRadius * 2.1]));
      glow(f, p.x, p.y, 20 * sc, [255, 246, 222], 0.9 * on);
    } else {
      const p = P(f, car.R([s * vc.wid * 0.33, vc.box.y0 + 0.3, 0.9]));
      glow(f, p.x, p.y, 13 * sc, [255, 40, 40], 0.7 * on);
    }
  }
}

function puffs(f: Pass, car: CarState) {
  if (f.style === 'blueprint' || !car.puffs.length) return;
  const g = f.g;
  const col: Rgb = f.prep.place.id === 'desert' ? [222, 150, 104] : [210, 200, 190];
  for (const th of car.puffs) {
    const a = seg(f.t - th, 0, 0.9);
    if (a <= 0 || a >= 1) continue;
    for (const [dx, dy] of [[-0.85, -1.45], [0.85, -1.45], [-0.85, 1.45], [0.85, 1.45]]) {
      const p = P(f, car.R([dx, dy, 0.05]));
      const rr = ((4 + a * 20) * f.pose.scale) / BASE_SCALE;
      g.fillStyle = css(col, 0.42 * (1 - a));
      g.beginPath();
      g.ellipse(p.x, p.y, rr, rr * 0.45, 0, 0, TAU);
      g.fill();
    }
  }
}

/** Two ruts pressed into the sand behind the vehicle, from where it really went. */
function sandTracks(f: Pass) {
  const prep = f.prep;
  const g = f.g;
  const half = prep.car.wid * 0.36;
  const back = prep.car.len * 0.32;
  const sides: { x: number; y: number; depth: number }[][] = [[], []];
  for (let k = 0; k <= 40; k++) {
    const tt = f.t - k * 0.08;
    if (tt < 0.5) break;
    const p = trajectory(prep.place, prep.variant, prep.end, tt);
    if (!p) break;
    const nx = Math.cos(p.h);
    const ny = -Math.sin(p.h);
    const bx = p.x - Math.sin(p.h) * back;
    const by = p.y - Math.cos(p.h) * back;
    sides[0].push(P(f, [bx + nx * half, by + ny * half, 0.01]));
    sides[1].push(P(f, [bx - nx * half, by - ny * half, 0.01]));
  }
  g.save();
  g.lineCap = 'round';
  g.lineWidth = (3.2 * f.pose.scale) / BASE_SCALE;
  for (const s of sides) {
    for (let i = 1; i < s.length; i++) {
      g.strokeStyle = css(grade(f, [120, 96, 66], s[i].depth, false), 0.32 * (1 - i / s.length));
      g.beginPath();
      g.moveTo(s[i - 1].x, s[i - 1].y);
      g.lineTo(s[i].x, s[i].y);
      g.stroke();
    }
  }
  g.restore();
}

function drawGlows(f: Pass, objs: readonly SceneObj[]) {
  for (const o of objs) {
    if (!o.glows) continue;
    for (const gl of o.glows) {
      const k = gl.always ? 1 : f.prep.T.lamps;
      if (k < 0.1) continue;
      const p = P(f, gl.p);
      glow(f, p.x, p.y, (gl.r * f.pose.scale) / BASE_SCALE, gl.c, 0.8 * k * (1 - fogOf(f, p.depth) * 0.6));
      if (gl.floor && !f.mirror) {
        const fl = P(f, [gl.p[0], gl.p[1], 0]);
        spot(f, fl.x, fl.y, (70 * f.pose.scale) / BASE_SCALE, gl.c, 0.22 * k, true);
      }
    }
  }
}

/** The print: the frame read back small, laid down again as a pink flat and a blue halftone. */
function risoPrint(f: Pass, frame: FrameBox) {
  const g = f.g;
  const scratch = f.prep.scratch;
  const cell = 4;
  const cw = Math.ceil(V / cell);
  const ch = Math.ceil(f.VH / cell);
  if (!scratch.rs || scratch.rs.c.width !== cw || scratch.rs.c.height !== ch) scratch.rs = scratchCanvas(cw, ch) ?? undefined;
  const rs = scratch.rs;
  if (!rs) return;
  rs.g.clearRect(0, 0, cw, ch);
  rs.g.drawImage(g.canvas as CanvasImageSource, 0, 0, frame.width, frame.height, 0, 0, cw, ch);
  const d = rs.g.getImageData(0, 0, cw, ch).data;
  const R = rng(Math.floor(f.t * 12) * 977 + 3);
  const jx = (R() - 0.5) * 2.4;
  const jy = (R() - 0.5) * 2.4;
  g.save();
  g.fillStyle = '#f1ece0';
  g.fillRect(0, 0, V, f.VH);
  g.globalCompositeOperation = 'multiply';
  const levels = [new Path2D(), new Path2D(), new Path2D()];
  const dots = new Path2D();
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      const r = d[i];
      const gg = d[i + 1];
      const b = d[i + 2];
      const lum = (0.3 * r + 0.59 * gg + 0.11 * b) / 255;
      const sat = (Math.max(r, gg, b) - Math.min(r, gg, b)) / 255;
      const pk = clamp(((r - b) / 255) * 1.9 + sat * 0.15);
      const lv = pk > 0.66 ? 2 : pk > 0.36 ? 1 : pk > 0.16 ? 0 : -1;
      if (lv >= 0) levels[lv].rect(x * cell + 2, y * cell + 2, cell, cell);
      const dark = clamp(1 - lum + Math.max(0, (b - r) / 255) * 0.7);
      if (dark > 0.12) {
        const rr = cell * 0.62 * Math.pow(dark, 1.1);
        const px = x * cell + cell / 2 + (y % 2) * (cell / 2) + jx;
        const py = y * cell + cell / 2 + jy;
        dots.moveTo(px + rr, py);
        dots.arc(px, py, rr, 0, TAU);
      }
    }
  }
  [0.25, 0.5, 0.8].forEach((a, k) => {
    g.fillStyle = css(PINK, a);
    g.fill(levels[k]);
  });
  g.fillStyle = css(BLUE, 0.92);
  g.fill(dots);
  if (scratch.grain === undefined) {
    const gc = scratchCanvas(128, 128);
    if (gc) {
      const id = gc.g.createImageData(128, 128);
      const r = rng(3);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = 150 + r() * 105;
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
        id.data[i + 3] = 255;
      }
      gc.g.putImageData(id, 0, 0);
    }
    scratch.grain = gc ? g.createPattern(gc.c as CanvasImageSource, 'repeat') : null;
  }
  if (scratch.grain) {
    g.globalAlpha = 0.16;
    g.fillStyle = scratch.grain;
    g.fillRect(0, 0, V, f.VH);
  }
  g.restore();
}

/** What stands in view at `t`: the tile laid again along the road, the far things following the camera. */
function inView(f: Pass, list: readonly SceneObj[], ground: boolean): { o: SceneObj; parts: Part[] }[] {
  const scene = f.prep.scene;
  const rot = { fx: f.pose.fx, fy: f.pose.fy };
  const [camX, camY] = f.cam;
  const out: { o: SceneObj; parts: Part[] }[] = [];
  for (const o of list) {
    for (const dx of tileOffsets(scene, o.about[0], o, camX)) {
      const dy = o.far ? camY * 0.95 : 0;
      const x = o.about[0] + dx;
      const y = o.about[1] + dy;
      const w = toWorld([x - camX, y - camY, 0], rot);
      if (Math.abs(w[0]) > (o.far ? 24 : 11.7)) continue;
      if (f.box && (Math.abs(x - f.box.cx) > f.box.W - 0.2 || Math.abs(y - f.box.cy) > f.box.D - 0.2)) continue;
      if (ground && !o.far && f.hz !== null && w[1] > f.hz - 0.5) continue;
      const at = o.camp && f.campAt !== null ? f.campAt + ((o.at ?? 0.4) - 0.4) * 0.5 : o.at ?? 0;
      const p = seg(f.t, at, at + 0.45);
      if (p <= 0) continue;
      const placed = dx || dy ? shiftedObj(o, dx, dy) : o;
      const s = p >= 1 ? 1 : Math.max(0.02, eBack(p, 1.8));
      out.push({ o: placed, parts: s >= 0.999 ? placed.parts : moveObj(placed, 0, 0, s).parts });
    }
  }
  return out;
}
const shiftCache = new WeakMap<SceneObj, Map<string, SceneObj>>();
function shiftedObj(o: SceneObj, dx: number, dy: number): SceneObj {
  if (o.far) return moveObj(o, dx, dy);
  let m = shiftCache.get(o);
  if (!m) shiftCache.set(o, (m = new Map()));
  const key = `${Math.round(dx * 100)}:${Math.round(dy * 100)}`;
  let c = m.get(key);
  if (!c) m.set(key, (c = moveObj(o, dx, dy)));
  return c;
}
function towersInView(f: Pass): Tower[] {
  const scene = f.prep.scene;
  const rot = { fx: f.pose.fx, fy: f.pose.fy };
  const [camX, camY] = f.cam;
  const out: Tower[] = [];
  for (const tw of scene.towers) {
    for (const dx of tileOffsets(scene, tw.x, tw, camX)) {
      const dy = tw.far ? camY * 0.95 : 0;
      const x = tw.x + dx;
      const w = toWorld([x - camX, tw.y + dy - camY, 0], rot);
      if (Math.abs(w[0]) > 12.5) continue;
      if (!tw.far && f.hz !== null && w[1] > f.hz - 0.5) continue;
      if (f.box && Math.abs(x - f.box.cx) > f.box.W - tw.w / 2) continue;
      out.push(dx || dy ? movedTower(tw, dx, dy) : tw);
    }
  }
  return out;
}

/**
 * One frame of a recipe, at `t` seconds, filling `frame`. The caller's
 * context is left as it was found.
 */
export function paintShowcase(g0: HookCtx2D, prep: ShowcasePrepared, t: number, frame: FrameBox): void {
  const g = g0 as AnyCtx;
  const k = frame.width / V;
  const VH = frame.height / k;
  const { o, place, variant, diorama } = prep;
  g.save();
  g.scale(k, k);
  g.beginPath();
  g.rect(0, 0, V, VH);
  g.clip();

  // The camera: designed on a 360 × 640 phone, closer in on a wider frame.
  const fit = Math.min(1, VH / 560);
  const wide = !diorama && !!place.horizon?.(variant);
  const turntable = place.turntable?.(variant) ?? false;
  const psi = place.cam.psi + (turntable ? 0 : orbitAt(t, wide));
  const tilt = diorama ? 0.56 : place.cam.tilt;
  const scale = (diorama ? 20.5 : BASE_SCALE) * fit;
  const oyBase = (diorama ? 372 : BASE_OY) * (VH / 640);
  const lift = diorama ? DIORAMA_RISE(t) : 0;
  const oy = oyBase - lift * Math.cos(tilt) * scale + (place.bob?.(variant, t) ?? 0);
  const pose: Pose = { fx: Math.sin(psi), fy: Math.cos(psi), tilt, scale, x: 180, y: oy };
  // The camera keeps the vehicle in the middle, and lets it drift a little when it leaves its lane.
  const traj = trajectory(place, variant, prep.end, t);
  const cam: [number, number] = traj ? [traj.x, lerp(traj.lane, traj.y, traj.follow)] : [0, 0];
  const c0 = project(toWorld([cam[0], cam[1], 0], pose), pose);
  pose.x += 180 - c0.x;
  pose.y += oy - c0.y;
  const hz = wide ? horizonDistance(tilt, scale, oyBase, BASE_HORIZON * (VH / 640)) : null;
  const T = prep.T;
  const camp = place.id === 'bivouac' && prep.end === 'offroad';
  const f: Pass = {
    g,
    t,
    prep,
    pose,
    view: viewDirection(tilt),
    mirror: false,
    d0: c0.depth,
    hz,
    hy: hz !== null ? oy - hz * Math.sin(tilt) * scale : null,
    hc: T.sky ? rgbOf(T.sky[2]) : T.fog,
    box: diorama ? { ...DIORAMA, cx: cam[0], cy: cam[1] } : null,
    Y0: toWorld([cam[0], cam[1], 0], pose)[1],
    cam,
    campOn: !camp || t > 6.5,
    campAt: camp ? 6.5 : null,
    VH,
    light: { ...prep.car.light, key: normalise(T.key), fill: normalise([-T.key[0], -T.key[1], 0.6]), ambient: T.amb + (prep.car.light.ambient - 0.4), keyWeight: T.keyW, fillWeight: 0.16 },
    style: o.look,
    car: null,
  };
  const car = carState({
    car: prep.car,
    place,
    variant,
    entry: o.entry,
    diorama,
    traj,
    t,
    screenX: (v) => P(f, v).x,
  });
  f.car = car;

  sky(f);
  if (f.box) slab(f, { ...prep.rgb } as Record<string, Rgb>, oyBase);
  place.ground(sceneDraw(f));

  const back = inView(f, prep.scene.objs, false);
  const mids = inView(f, prep.scene.mids, true);
  const backParts = back.flatMap((x) => x.parts);
  const midParts = mids.flatMap((x) => x.parts);
  const towers = towersInView(f);
  const rise = (tw: Tower) => {
    const d = Math.hypot(tw.bx ?? tw.x, tw.y) * 0.015;
    return eOut(seg(t, 0.05 + d, 1.0 + d));
  };
  const haze = f.hy !== null ? 0.32 : 0;

  // The reflection: the same world seen from under the ground, drawn small so it comes back soft.
  const rf = place.reflect?.(variant, prep.W) ?? null;
  if (rf && o.look !== 'blueprint') {
    const rw = Math.ceil(V / 3);
    const rh = Math.ceil(VH / 3);
    if (!prep.scratch.refl || prep.scratch.refl.c.width !== rw || prep.scratch.refl.c.height !== rh) prep.scratch.refl = scratchCanvas(rw, rh) ?? undefined;
    const refl = prep.scratch.refl;
    if (refl) {
      const rg = refl.g;
      rg.setTransform(1, 0, 0, 1, 0, 0);
      rg.clearRect(0, 0, rw, rh);
      rg.setTransform(1 / 3, 0, 0, -1 / 3, 0, (2 * pose.y) / 3);
      const mpose: Pose = { ...pose, tilt: -tilt };
      const m: Pass = { ...f, g: rg, mirror: true, pose: mpose, view: viewDirection(-tilt) };
      if (backParts.length) paintFaces(m, renderOrder(backParts, mpose, f.light), null, haze);
      for (const tw of towers) drawTower(m, tw, rise(tw));
      paintFaces(m, renderOrder([...midParts, ...car.parts], mpose, f.light), car);
      drawGlows(m, [...back.map((x) => x.o), ...mids.map((x) => x.o)]);
      lights(m, car, 'glow');
      const polys = rf.wetAll ? [[[-200, -80], [200, -80], [200, 220], [-200, 220]] as const] : rf.polys;
      g.save();
      g.beginPath();
      for (const poly of polys) {
        let vs: Vec3[] = poly.map((v) => [v[0], v[1], 0] as Vec3);
        if (f.box) vs = clipRect(vs, f.box.W, f.box.D, f.box.cx, f.box.cy);
        if (vs.length < 3) continue;
        const pts = vs.map((v) => P(f, v));
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
      }
      g.clip();
      g.globalAlpha = rf.a;
      g.drawImage(refl.c as CanvasImageSource, 0, 0, V, VH);
      g.globalAlpha = rf.a * 0.4;
      g.drawImage(refl.c as CanvasImageSource, 0, 6, V, VH);
      g.restore();
    }
  }

  // The shadow and the beams lie on the ground.
  if (o.look !== 'blueprint' && car.shadow > 0) {
    const sp = P(f, [car.P[0], car.P[1], 0]);
    const yaw = Math.atan2(pose.fx, pose.fy);
    paintGroundShadow(
      g,
      { fx: Math.sin(car.h + yaw), fy: Math.cos(car.h + yaw), tilt, scale, x: sp.x, y: sp.y },
      prep.car.len / 2,
      prep.car.wid / 2,
      (T.lamps > 0.9 ? 0.4 : 0.3) * car.shadow,
    );
  }
  lights(f, car, 'ground');
  if (place.tracks && traj && o.look !== 'blueprint') sandTracks(f);
  if (f.hy !== null && o.look !== 'blueprint') {
    const gr = g.createLinearGradient(0, f.hy, 0, f.hy + 110);
    gr.addColorStop(0, css(f.hc, 1));
    gr.addColorStop(1, css(f.hc, 0));
    g.fillStyle = gr;
    g.fillRect(0, f.hy - 1, V, 111);
  }

  if (backParts.length) paintFaces(f, renderOrder(backParts, pose, f.light), null, haze);
  const carDepth = P(f, car.P).depth;
  const ordered = towers.map((tw) => ({ tw, d: P(f, [tw.x, tw.y, 0]).depth })).sort((a, b) => b.d - a.d);
  for (const { tw, d } of ordered) if (d > carDepth) drawTower(f, tw, rise(tw));
  paintFaces(f, renderOrder([...midParts, ...car.parts], pose, f.light), car);
  for (const { tw, d } of ordered) if (d <= carDepth) drawTower(f, tw, rise(tw));
  drawGlows(f, [...back.map((x) => x.o), ...mids.map((x) => x.o)]);
  lights(f, car, 'glow');
  puffs(f, car);
  const fx = place.fx?.(variant);
  if (fx === 'gulls') gulls(f);
  if (fx === 'fire') fireFx(f);
  weatherFx(f);

  if (car.sweep && car.sweep.veil > 0 && o.look !== 'blueprint') {
    const { lx, veil } = car.sweep;
    const a = 0.94 * veil;
    const gr = g.createLinearGradient(lx - 110, 0, lx + 110, 0);
    gr.addColorStop(0, `rgba(0,0,0,${a})`);
    gr.addColorStop(0.38, `rgba(0,0,0,${a * 0.2})`);
    gr.addColorStop(0.5, 'rgba(0,0,0,0)');
    gr.addColorStop(0.62, `rgba(0,0,0,${a * 0.2})`);
    gr.addColorStop(1, `rgba(0,0,0,${a})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, V, VH);
    g.fillStyle = `rgba(0,0,0,${a})`;
    if (lx > -110) g.fillRect(0, 0, Math.max(0, lx - 110), VH);
    if (lx < V + 110) g.fillRect(lx + 110, 0, V, VH);
  }
  if (o.look === 'riso') risoPrint(f, frame);
  // The film's first instant comes out of black (or the paper).
  const fade = 1 - seg(t, 0, 0.35);
  if (fade > 0) {
    g.fillStyle = css(o.look === 'blueprint' ? PLAN_BG : o.look === 'riso' ? [241, 236, 224] : [0, 0, 0], fade);
    g.fillRect(0, 0, V, VH);
  }
  g.restore();
}
