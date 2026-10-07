/**
 * The OpenStreetMap ground an opener draws under a FOLLOWING camera: one
 * wide raster over everything the camera can reach, and a zoom PYRAMID of
 * tiles along the subject's road, each frame's own ground at the zoom its
 * delivery asks (`shared/map/tile-strip.ts`) — shared by Virée
 * (`drive-paint.ts`) and the Itinerary (`map-plan.ts`, `map-paint.ts`), which
 * differ only in how a plan rectangle is turned into degrees.
 *
 * Planning is pure and DOM-free; `paintGround` is the one drawing both
 * painters call.
 */

import { BASEMAP_FOR_EDGE, TILE_PX, basemapKey, planTiles, type GeoBox } from '../../map/tile-math';
import { planPyramid, tileBox, zoomForDensity, type PyramidTile, type StripSample } from '../../map/tile-strip';
import { drawBasemap } from './basemap-paint';
import type { CameraTrack } from './drive-plan';
import type { HookBasemapWant, HookCtx2D, HookPicture } from './hook-variant';
import { TRACK_FPS } from './map-camera';

export interface BasemapSet {
  wide: HookBasemapWant;
  /** The pyramid's tiles, coarse levels first — each a one-tile raster at its own zoom. */
  patches: readonly HookBasemapWant[];
  /** Each patch's tile, in the same order. */
  tiles: readonly PyramidTile[];
  /**
   * The zoom the frame at `t` is delivered at — the deepest level the paint
   * draws there (a finer one a tighter frame nearby fetched is left out: it
   * would cost draws and add nothing). −1 when the wide raster is enough.
   */
  levelAt: (t: number) => number;
  /** Levels every frame gave up to the budget, and how much detail they kept (`PyramidPlan`). */
  short: number;
  sharp: number;
  frames: number;
  /** Tiles the drive would cost at full detail. */
  full: number;
  /** Every raster, in the order the shell fetches it: the wide one first, then the pyramid coarse to fine. */
  wants: readonly HookBasemapWant[];
}

/** The set with the wide raster alone. */
export function wideOnly(wide: HookBasemapWant): BasemapSet {
  return { wide, patches: [], tiles: [], levelAt: () => -1, short: 0, sharp: 0, frames: 0, full: 0, wants: [wide] };
}

/** A few plans kept, so a panel re-rendering on every keystroke does not sweep the drive again. */
const planned = new Map<string, BasemapSet>();
const PLANNED_KEEP = 8;

/**
 * The pyramid along a following camera's road, over `wide`: every frame the
 * track shows (baked at `TRACK_FPS`, so a frame the export draws IS a
 * sample) as a region in degrees, the density its delivery asks and how fast
 * the ground moves under it. `budget` is the tiles it may hold
 * (`stripBudget()`); 0 asks for none.
 */
export function stripOver(
  wide: HookBasemapWant,
  track: CameraTrack,
  {
    box,
    frame,
    diagonal,
    regionOf,
    unitsPerDegree,
    budget,
  }: {
    /** The map's box on the nominal frame — what a frame's width spans. */
    box: { width: number };
    /** The nominal frame. */
    frame: { width: number; height: number };
    /** Whether the frame turns (heading-up): its diagonal is then what it reaches. */
    diagonal: boolean;
    /** A rectangle in plan units as a region in degrees. */
    regionOf: (x0: number, x1: number, y0: number, y1: number) => GeoBox;
    /** Plan units per degree of longitude. */
    unitsPerDegree: number;
    budget: number;
  },
): BasemapSet {
  const out = wideOnly(wide);
  if (!(budget > 0) || !(track.seconds >= 0)) return out;
  const { width: w, height: h } = frame;
  // The delivery's long edge is `BASEMAP_FOR_EDGE` whatever the shape: a
  // portrait frame's WIDTH is 1 080 of it, not 1 920 — reading the width as
  // the long edge asked a portrait piece one zoom too deep, four times the tiles.
  const deliveredPerNominal = BASEMAP_FOR_EDGE / Math.max(w, h);
  const reach = diagonal ? Math.hypot(w, h) : 0;
  const steps = Math.max(1, Math.ceil(track.seconds * TRACK_FPS));
  const samples: StripSample[] = [];
  const zooms: number[] = [];
  let before: { x: number; y: number; width: number } | null = null;
  for (let k = 0; k <= steps; k++) {
    const f = track.at(k / TRACK_FPS);
    if (!(f.width > 0)) {
      zooms.push(-1);
      continue;
    }
    const unitsPerPx = f.width / box.width;
    const reachX = Math.max(w, reach) * unitsPerPx * 0.5;
    const reachY = Math.max(h, reach) * unitsPerPx * 0.5;
    const region = regionOf(f.centre.x - reachX, f.centre.x + reachX, f.centre.y - reachY, f.centre.y + reachY);
    const pxPerDeg = (deliveredPerNominal / unitsPerPx) * unitsPerDegree;
    zooms.push(zoomForDensity(pxPerDeg));
    // Screen pixels the ground moves in a second: the pan, plus the zoom
    // measured at the box's edge.
    const motion = before
      ? (Math.hypot(f.centre.x - before.x, f.centre.y - before.y) / unitsPerPx +
          Math.abs(Math.log(f.width / before.width)) * box.width) *
        TRACK_FPS
      : 0;
    before = { x: f.centre.x, y: f.centre.y, width: f.width };
    if (!(region.east > region.west) || !(region.north > region.south)) continue;
    samples.push({ box: region, pxPerDeg, motion });
  }
  const floor = planTiles(wide.box, wide.width, wide.height)?.z ?? 0;
  const key = `${wide.key}#${budget}#${samples.map((s) => `${s.box.west.toFixed(4)},${s.box.north.toFixed(4)},${s.box.east.toFixed(4)},${s.pxPerDeg.toPrecision(5)}`).join(';')}`;
  const kept = planned.get(key);
  if (kept) return kept;
  const plan = planPyramid(samples, budget, { floor });
  let set: BasemapSet = out;
  if (plan) {
    const patches = plan.tiles.map(({ z, x, y }): HookBasemapWant => {
      const patch = tileBox(x, y, z);
      return { key: basemapKey(patch, TILE_PX, TILE_PX), box: patch, width: TILE_PX, height: TILE_PX, zoom: z };
    });
    const levelAt = (t: number) => {
      const f = Math.max(0, Math.min(zooms.length - 1, t * TRACK_FPS));
      const i = Math.floor(f);
      return Math.max(zooms[i], zooms[Math.min(zooms.length - 1, i + 1)]);
    };
    set = {
      wide,
      patches,
      tiles: plan.tiles,
      levelAt,
      short: plan.short,
      sharp: plan.sharp,
      frames: plan.frames,
      full: plan.full,
      wants: [wide, ...patches],
    };
  }
  planned.set(key, set);
  while (planned.size > PLANNED_KEEP) planned.delete(planned.keys().next().value as string);
  return set;
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * The pyramid's tiles the frame at `t` reaches, coarse to fine — only levels
 * up to the frame's own (`levelAt`), only those whose rectangle meets `seen`
 * (the frame, or its diagonal's square when the map turns), only those the
 * shell has landed, and never one whose four children are all landed too:
 * they cover it whole, and drawing every level under the finest cost a
 * frame five times the wide raster's fill (measured headless). A tile still
 * missing leaves the level under it, and under them all the wide raster:
 * never a hole.
 */
export function visiblePatches(
  basemap: BasemapSet,
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  rectOf: (want: HookBasemapWant) => Rect,
  seen: { x0: number; y0: number; x1: number; y1: number },
  t: number,
): { picture: HookPicture; rect: Rect }[] {
  const level = basemap.levelAt(t);
  const out: { picture: HookPicture; rect: Rect }[] = [];
  if (level < 0 || !pictures) return out;
  const landed = new Set<string>();
  basemap.patches.forEach((patch, i) => {
    const tile = basemap.tiles[i];
    if (tile && tile.z <= level && pictures.has(patch.key)) landed.add(`${tile.z}/${tile.x}/${tile.y}`);
  });
  basemap.patches.forEach((patch, i) => {
    const tile = basemap.tiles[i];
    if (!tile || !landed.has(`${tile.z}/${tile.x}/${tile.y}`)) return;
    const z = tile.z + 1;
    const x = tile.x * 2;
    const y = tile.y * 2;
    if (landed.has(`${z}/${x}/${y}`) && landed.has(`${z}/${x + 1}/${y}`) && landed.has(`${z}/${x}/${y + 1}`) && landed.has(`${z}/${x + 1}/${y + 1}`)) return;
    const rect = rectOf(patch);
    if (rect.x + rect.width < seen.x0 || rect.x > seen.x1 || rect.y + rect.height < seen.y0 || rect.y > seen.y1) return;
    out.push({ picture: pictures.get(patch.key)!, rect });
  });
  return out;
}

/** The one layer the ground is composed in when it is drawn at less than full strength. */
let layer: OffscreenCanvas | null = null;

/**
 * The ground — the wide raster, then the pyramid's levels over it — at
 * `opacity`. Several layers drawn each at the strength would darken where
 * they overlap (the paper shows 10 % through one at 0.9, 1 % through two),
 * so under full strength they are composed whole in a layer of the frame's
 * size, under the context's own transform, and that layer is laid down once.
 * The caller's clip and rotation apply as for any drawing.
 */
export function paintGround(
  g: HookCtx2D,
  basemap: BasemapSet,
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  wide: HookPicture,
  rectOf: (want: HookBasemapWant) => Rect,
  seen: { x0: number; y0: number; x1: number; y1: number },
  t: number,
  opacity: number,
): void {
  const fine = visiblePatches(basemap, pictures, rectOf, seen, t);
  const target = { width: g.canvas.width, height: g.canvas.height };
  const composed = fine.length > 0 && opacity < 0.999 && typeof OffscreenCanvas !== 'undefined';
  if (!composed) {
    drawBasemap(g, wide, rectOf(basemap.wide), opacity);
    for (const { picture, rect } of fine) drawBasemap(g, picture, rect, opacity);
    return;
  }
  if (!layer || layer.width !== target.width || layer.height !== target.height) {
    layer = new OffscreenCanvas(target.width, target.height);
  }
  const lg = layer.getContext('2d');
  if (!lg) return;
  lg.setTransform(1, 0, 0, 1, 0, 0);
  lg.clearRect(0, 0, target.width, target.height);
  lg.setTransform(g.getTransform());
  drawBasemap(lg, wide, rectOf(basemap.wide), 1);
  for (const { picture, rect } of fine) drawBasemap(lg, picture, rect, 1);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = opacity;
  g.drawImage(layer, 0, 0);
  g.restore();
}

/**
 * What a recorded file's map ground lost, in one line, from the pictures'
 * status once an export has waited for them — or null when every tile the
 * openers asked for is in. A tile that failed leaves the coarser ground under
 * it (its parent, or the wide raster); the wide raster failing leaves the paper.
 */
export function groundNote(status: { problems: ReadonlyMap<string, string>; coarser?: number } | undefined): string | null {
  if (!status) return null;
  const failed = [...status.problems.keys()].filter((key) => key.startsWith('osm:')).length;
  const coarser = status.coarser ?? 0;
  const parts: string[] = [];
  if (failed) parts.push(`${failed} map ${failed === 1 ? 'tile' : 'tiles'} could not be fetched — a coarser map stands in there`);
  if (coarser) parts.push(`${coarser} came from a coarser zoom, a little softer`);
  return parts.length ? parts.join('; ') : null;
}
