/**
 * What a Storytelling map is drawn OVER (his ask, 2026-11-01: « soit sans map
 * libre, soit un truc vectoriel préparé en dur, soit la map avec les tuiles »):
 *
 * - `outline` — the shipped coastline (`australia.json`), the default and the
 *   series' look until he picks another;
 * - `none` — no land at all, the route alone on the charte's ground;
 * - `tiles` — OpenStreetMap, toned like Flight Atlas's ground
 *   (`tile-tone.ts`), the suite's tiles exception under its rules: the
 *   device's consent (`osm-tiles.ts`), nothing fetched before, the credit
 *   drawn on every frame that shows them — and only on those.
 *
 * The map's projection is linear in longitude and latitude (`geo.ts`,
 * `proj`), and so is the raster `loadBasemap` lays out of Web Mercator, so a
 * raster is ONE affine `drawImage` into its box: the tiles cannot drift from
 * the route. The rasters are fetched by the editor (`use-map-ground.ts`) and
 * handed to every frame, like the wall's pictures; until they land, or where
 * the device has not said yes, the outline stands in.
 */
import type { GeoBox } from '../map/tile-math';
import { TILE_TONES, type TileTone } from '../map/tile-tone';
import { OSM_CREDIT } from '../map/track-map';
import { coastPaths, proj } from './geo';
import { PAL } from './charte';
import type { Ctx } from './motion';

export type MapGroundKind = 'none' | 'outline' | 'tiles';
export const MAP_GROUND_KINDS: readonly MapGroundKind[] = ['outline', 'none', 'tiles'];

/** The series' map ground (`StoryLook.map`), each field over its default. */
export interface MapGround {
  ground?: MapGroundKind;
  /** How the tiles are toned (Flight Atlas's four). */
  tone?: TileTone;
  /** How strongly the tiles show over the charte's ground, 0.2–1. */
  strength?: number;
}

export const MAP_GROUND_DEFAULTS: Required<MapGround> = { ground: 'outline', tone: 'grey', strength: 0.8 };

/** A series' map ground, kept field by field when well formed. (pure) */
export function readMapGround(raw: unknown): MapGround | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: MapGround = {};
  if (typeof r.ground === 'string' && (MAP_GROUND_KINDS as readonly string[]).includes(r.ground)) out.ground = r.ground as MapGroundKind;
  if (typeof r.tone === 'string' && (TILE_TONES as readonly string[]).includes(r.tone)) out.tone = r.tone as TileTone;
  if (typeof r.strength === 'number' && Number.isFinite(r.strength)) out.strength = Math.min(1, Math.max(0.2, r.strength));
  return Object.keys(out).length ? out : undefined;
}

/** The map's longitude and latitude at a point of its own units — `proj` turned back. (pure) */
export const unproj = (x: number, y: number): [number, number] => [133.5 + (x - 540) / (23.6 * 0.906), -27 - (y - 900) / 23.6];

/** A box of the map's units as longitudes and latitudes. (pure) */
const geoBoxOf = (x0: number, y0: number, x1: number, y1: number): GeoBox => {
  const [west, north] = unproj(x0, y0);
  const [east, south] = unproj(x1, y1);
  return { west, south, east, north };
};

/**
 * What the whole map shows at its widest: the frame at ×1 (1080 × 1920), a
 * block lifting it a little (`MAP_DY`) included — down to 64° S and no
 * further, where Antarctica's ice drew a white band under the caption; the
 * raster FADES out over its last rows instead of stopping on a hard edge
 * (both seen headless).
 */
const WIDE_UNITS = [-60, -120, 1140, 1800] as const;
/** The share of the wide raster's height that fades out at its foot. */
export const WIDE_FADE = 0.16;
/** Around the route, the margin a following camera at ×2.3 sees beside it (half its frame and a little more, across; a little over a third, down). */
const NEAR_MARGIN = [300, 360] as const;
/**
 * How far the near raster may reach: past the wide one across, since a camera
 * following a coast road sees beyond the frame's own edge (the wide raster's
 * edge showed at ×2.3 over Brisbane, seen headless).
 */
const NEAR_UNITS = [-360, -120, 1440, 1800] as const;

/**
 * The two rasters a map ground asks for: the WIDE one, everything the map
 * shows at ×1, coarse; and the NEAR one around the route (`route`, in the
 * map's units), as fine as the tile server's budget allows, for the camera
 * that follows it at ×2.3. Each with the pixels it is drawn at. (pure)
 */
export function groundBoxes(route: readonly (readonly [number, number])[]): { box: GeoBox; width: number; height: number; fade?: number }[] {
  const [wx0, wy0, wx1, wy1] = WIDE_UNITS;
  const out: { box: GeoBox; width: number; height: number; fade?: number }[] = [
    { box: geoBoxOf(wx0, wy0, wx1, wy1), width: 1200, height: Math.round((1200 * (wy1 - wy0)) / (wx1 - wx0)), fade: WIDE_FADE },
  ];
  if (route.length < 2) return out;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of route) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const [nx0, ny0, nx1, ny1] = NEAR_UNITS;
  x0 = Math.max(nx0, x0 - NEAR_MARGIN[0]);
  x1 = Math.min(nx1, x1 + NEAR_MARGIN[0]);
  y0 = Math.max(ny0, y0 - NEAR_MARGIN[1]);
  y1 = Math.min(ny1, y1 + NEAR_MARGIN[1]);
  if (x1 - x0 < 10 || y1 - y0 < 10) return out;
  // 2.3 pixels a unit, as the camera draws them, the longest side at most 3 072.
  const k = Math.min(2.3, 3072 / Math.max(x1 - x0, y1 - y0));
  out.push({ box: geoBoxOf(x0, y0, x1, y1), width: Math.round((x1 - x0) * k), height: Math.round((y1 - y0) * k) });
  return out;
}

/** A raster laid on the map: its pixels, and the box they cover, linear in longitude and latitude. */
export interface GroundLayer {
  image: CanvasImageSource;
  box: GeoBox;
  /**
   * The open sea's colour in this raster, toned — what the map is filled
   * with beyond it, so a camera seeing past its edge (the frame's foot at
   * ×1, south of 64° S) sees more sea rather than the charte's ground under
   * a fade (his « bandeau en bas », 2026-11-02). Measured, never assumed: it
   * is the tone's own.
   */
  sea?: string;
}

/**
 * The sea's colour of a raster, from a band of its rows that holds open
 * water: each channel's MEDIAN over the band, so a stray label, a graticule
 * line or an island does not tint it. Null with nothing opaque in the band.
 * (pure)
 */
export function seaColour(data: Uint8ClampedArray, width: number, fromRow: number, toRow: number): string | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (let y = Math.max(0, Math.floor(fromRow)); y < Math.floor(toRow); y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 250) continue;
      r.push(data[i]);
      g.push(data[i + 1]);
      b.push(data[i + 2]);
    }
  }
  if (!r.length) return null;
  const median = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1];
  return `rgb(${median(r)},${median(g)},${median(b)})`;
}

/** Where a wide raster's open sea is read: a band just above its fade, south of the land (about 55° to 60° S). */
export function seaBand(height: number, fade: number): [number, number] {
  const to = height * (1 - fade);
  return [to - height * 0.06, to];
}

let GROUND: Required<MapGround> = MAP_GROUND_DEFAULTS;
let LAYERS: readonly GroundLayer[] = [];

/** Set what the frames that follow draw the map over: the series' choice, and the rasters fetched for it (none yet: the outline). */
export function setGround(ground: MapGround | null | undefined, layers: readonly GroundLayer[] | null | undefined): void {
  GROUND = { ...MAP_GROUND_DEFAULTS, ...(ground ?? {}) };
  LAYERS = layers ?? [];
}

/** Whether the frames that follow draw tiles — and so their credit. */
export const tilesShown = (): boolean => GROUND.ground === 'tiles' && LAYERS.length > 0;

/**
 * The map's ground, in the map's units: the tiles at the series' strength,
 * the coastline (`alpha`, `width` as the block asks), or nothing.
 */
export function drawGround(c: Ctx, alpha: number, width: number): void {
  if (alpha <= 0 || GROUND.ground === 'none') return;
  if (tilesShown()) {
    c.save();
    c.globalAlpha *= alpha * GROUND.strength;
    c.imageSmoothingQuality = 'high';
    // The sea beyond the rasters, at their strength: a camera looking past their edge sees open water,
    // and the wide raster's fading foot melts into it rather than into the charte's ground.
    const sea = LAYERS.find((l) => l.sea)?.sea;
    if (sea) {
      c.fillStyle = sea;
      c.fillRect(-4000, -4000, 9080, 9920);
    }
    const rects = LAYERS.map(({ box }) => {
      const [x0, y0] = proj(box.west, box.north);
      const [x1, y1] = proj(box.east, box.south);
      return [x0, y0, x1 - x0, y1 - y0] as const;
    });
    LAYERS.forEach(({ image }, i) => {
      // Each raster only where no finer one lies over it: two layers at the same strength
      // stacked read darker, and the finer one's edge showed as a step (seen headless at ×2.3).
      const above = rects.slice(i + 1);
      c.save();
      if (above.length) {
        const keep = new Path2D();
        keep.rect(...rects[i]);
        for (const r of above) keep.rect(...r);
        c.clip(keep, 'evenodd');
      }
      c.drawImage(image, ...rects[i]);
      c.restore();
    });
    c.restore();
    return;
  }
  c.save();
  c.globalAlpha *= alpha;
  c.strokeStyle = PAL.dim;
  c.lineJoin = 'round';
  c.lineWidth = width;
  coastPaths().forEach((p) => c.stroke(p));
  c.restore();
}

/** The credit the tiles' licence asks for, while they are drawn; null otherwise. */
export const groundCredit = (): string | null => (tilesShown() ? OSM_CREDIT : null);
