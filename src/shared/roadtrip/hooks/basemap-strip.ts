/**
 * The OpenStreetMap ground an opener draws under a FOLLOWING camera: one
 * wide raster over everything the camera can reach, and a STRIP of finer
 * patches along the subject's road at the follow's own zoom
 * (`shared/map/tile-strip.ts`) — shared by Virée (`drive-paint.ts`) and the
 * Itinerary (`map-plan.ts`), which differ only in how a plan rectangle is
 * turned into degrees.
 *
 * Pure and DOM-free.
 */

import { BASEMAP_FOR_EDGE, TILE_PX, basemapKey, planTiles, rasterSize, type GeoBox } from '../../map/tile-math';
import { STRIP_BLOCK, STRIP_FADE_FROM, STRIP_FADE_TO, planStrip, type StripSample } from '../../map/tile-strip';
import type { CameraTrack } from './drive-plan';
import type { HookBasemapWant } from './hook-variant';

export interface BasemapSet {
  wide: HookBasemapWant;
  patches: readonly HookBasemapWant[];
  /** The patches' zoom, and the follow's own width in plan units — the fade's measure. */
  patchZoom: number | null;
  followUnits: number;
  /** Every raster, in the order the shell fetches it: the wide one first. */
  wants: readonly HookBasemapWant[];
}

/** How often the following camera's frames are sampled for the strip. */
const STRIP_SAMPLES_PER_SECOND = 10;

/** The set with the wide raster alone. */
export function wideOnly(wide: HookBasemapWant): BasemapSet {
  return { wide, patches: [], patchZoom: null, followUnits: 0, wants: [wide] };
}

/**
 * The strip along a following camera's road, over `wide`: every frame the
 * track shows, sampled over the drive, as a region in degrees and the
 * density a delivery of it asks; a frame pulled back past `STRIP_FADE_TO`
 * times the follow's own width — a long hop's middle, the wide shots — is
 * not swept, it shows the wide raster. `budget` is the tiles the strip may
 * cost (`stripBudget()`); 0 asks for none.
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
    kmPerUnit,
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
    kmPerUnit: number;
    budget: number;
  },
): BasemapSet {
  const out = wideOnly(wide);
  if (!(budget > 0) || !(track.seconds >= 0)) return out;
  const { width: w, height: h } = frame;
  const samples: StripSample[] = [];
  const steps = Math.max(1, Math.ceil(track.seconds * STRIP_SAMPLES_PER_SECOND));
  const followUnits = track.viewKm / Math.max(1e-9, kmPerUnit);
  const widest = (STRIP_FADE_TO * followUnits * (w / box.width)) / unitsPerDegree;
  for (let k = 0; k <= steps; k++) {
    const f = track.at((track.seconds * k) / steps);
    if (!(f.width > 0)) continue;
    const unitsPerPx = f.width / box.width;
    const reachX = (diagonal ? Math.hypot(w, h) : w) * unitsPerPx * 0.5;
    const reachY = (diagonal ? Math.hypot(w, h) : h) * unitsPerPx * 0.5;
    const sample = regionOf(f.centre.x - reachX, f.centre.x + reachX, f.centre.y - reachY, f.centre.y + reachY);
    if (!(sample.east > sample.west) || !(sample.north > sample.south)) continue;
    samples.push({ box: sample, pxPerDeg: (BASEMAP_FOR_EDGE / (w * unitsPerPx)) * unitsPerDegree });
  }
  const wideZoom = planTiles(wide.box, wide.width, wide.height)?.z ?? 0;
  const strip = planStrip(samples, budget, { deeperThan: wideZoom, widest });
  if (!strip) return out;
  const side = STRIP_BLOCK * TILE_PX;
  const patches = strip.patches.map((patch): HookBasemapWant => {
    const s = rasterSize(patch, side, side);
    return { key: basemapKey(patch, s.width, s.height), box: patch, ...s, zoom: strip.z };
  });
  return { wide, patches, patchZoom: strip.z, followUnits, wants: [wide, ...patches] };
}

/**
 * How strongly the strip's patches show on a frame whose map box is
 * `boxUnits` plan units wide: whole up to `STRIP_FADE_FROM` times the
 * follow's own width, gone at `STRIP_FADE_TO` — where the sweep stopped.
 */
export function patchAlpha(basemap: Pick<BasemapSet, 'patches' | 'followUnits'>, boxUnits: number): number {
  if (!basemap.patches.length || !(basemap.followUnits > 0)) return 0;
  const times = boxUnits / basemap.followUnits;
  const f = (times - STRIP_FADE_FROM) / (STRIP_FADE_TO - STRIP_FADE_FROM);
  if (f <= 0) return 1;
  if (f >= 1) return 0;
  return 1 - f * f * (3 - 2 * f);
}

/**
 * The patches the frame reaches, drawn after the wide raster at `fade`
 * — only those whose rectangle meets `seen` (the frame, or its diagonal's
 * square when the map turns).
 */
export function visiblePatches(
  basemap: BasemapSet,
  pictures: ReadonlyMap<string, { image: CanvasImageSource; width: number; height: number }> | undefined,
  rectOf: (want: HookBasemapWant) => { x: number; y: number; width: number; height: number },
  seen: { x0: number; y0: number; x1: number; y1: number },
): { picture: { image: CanvasImageSource; width: number; height: number }; rect: { x: number; y: number; width: number; height: number } }[] {
  const out: { picture: { image: CanvasImageSource; width: number; height: number }; rect: { x: number; y: number; width: number; height: number } }[] = [];
  for (const patch of basemap.patches) {
    const picture = pictures?.get(patch.key);
    if (!picture) continue;
    const rect = rectOf(patch);
    if (rect.x + rect.width < seen.x0 || rect.x > seen.x1 || rect.y + rect.height < seen.y0 || rect.y > seen.y1) continue;
    out.push({ picture, rect });
  }
  return out;
}
