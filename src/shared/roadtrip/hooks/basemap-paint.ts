/**
 * Drawing an opener's OpenStreetMap background, and the credit it owes.
 *
 * The raster arrives with latitude and longitude both linear
 * (`shared/map/osm-tiles.ts`), so it lands on any of the openers'
 * projections by placing its two corners — the north-west and the south-east
 * of its region — where the projection puts them. What the licence asks is
 * not optional: every frame the tiles are in says «© OpenStreetMap
 * contributors», the preview and the delivered file alike.
 */

import { OSM_CREDIT } from '../../map/track-map';
import type { HookBasemapWant, HookCtx2D, HookPicture } from './hook-variant';

/** Where a region's raster goes, from where its two corners project. */
export function basemapRect(
  want: Pick<HookBasemapWant, 'box'>,
  project: (p: { lat: number; lon: number }) => { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  const nw = project({ lat: want.box.north, lon: want.box.west });
  const se = project({ lat: want.box.south, lon: want.box.east });
  return { x: nw.x, y: nw.y, width: se.x - nw.x, height: se.y - nw.y };
}

/** The raster at `rect`, at `alpha`. A bitmap released under a render in flight draws nothing. */
export function drawBasemap(
  g: HookCtx2D,
  picture: HookPicture,
  rect: { x: number; y: number; width: number; height: number },
  alpha: number,
): void {
  if (!(rect.width > 0) || !(rect.height > 0)) return;
  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingQuality = 'high';
  try {
    g.drawImage(picture.image, rect.x, rect.y, rect.width, rect.height);
  } catch {
    /* the next frame draws with the new set */
  }
  g.restore();
}

/**
 * The credit, bottom-right of `area`, on a pale chip so it reads over any
 * tile. `u` is the frame's 1080-unit.
 */
export function paintOsmCredit(
  g: HookCtx2D,
  area: { x: number; y: number; width: number; height: number },
  u: number,
): void {
  const size = Math.max(9, 15 * u);
  g.save();
  g.globalAlpha = 1;
  g.font = `500 ${size}px 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif`;
  const text = OSM_CREDIT;
  const pad = 5 * u;
  const width = g.measureText(text).width + pad * 2;
  const height = size + pad * 1.4;
  const x = area.x + area.width - width - 8 * u;
  const y = area.y + area.height - height - 8 * u;
  g.fillStyle = 'rgba(244,240,231,0.78)';
  g.fillRect(x, y, width, height);
  g.fillStyle = 'rgba(28,26,23,0.9)';
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(text, x + pad, y + height / 2);
  g.restore();
}
