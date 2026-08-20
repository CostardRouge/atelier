/**
 * Composer-specific camera maths for the export map. The look of the map
 * itself (style, track layer, tiles) lives in `shared/map/track-map.ts`; this
 * file only knows how to reproduce the preview's framing at export resolution.
 */

import type { LngLatBoundsLike, LngLatLike, Map as MlMap } from 'maplibre-gl';
import { trackBounds, type TrackPoint } from '../../shared/telemetry/flight-path';

/** Padding (px) the live preview frames the track with, at preview resolution. */
const FIT_PADDING = 40;

/**
 * The fit camera (centre + zoom) for the whole track, without moving the map.
 *
 * `previewScale` is how much smaller the on-screen preview is than this
 * (full-resolution) export map — e.g. 0.75 when a Full HD export is previewed at
 * the 1440px preview cap. `cameraForBounds` is resolution-dependent: on a larger
 * canvas it fits the same bounds at a higher zoom, and a fixed-pixel padding is a
 * smaller *fraction* of it. Left uncorrected the export would frame the track at
 * a different scale than the preview. Scaling the padding (and the single-point
 * fallback zoom) by `1 / previewScale` reproduces the preview's apparent scale,
 * so the recorded map matches what the user set up.
 */
export function cameraForTrack(
  map: MlMap,
  track: readonly TrackPoint[],
  previewScale = 1,
): { center: LngLatLike; zoom: number } | null {
  const b = trackBounds(track);
  if (!b) return null;
  // The export canvas is 1 / previewScale larger than the preview, i.e. this
  // many zoom levels further in for the same apparent scale.
  const zoomDelta = Math.log2(1 / previewScale);
  if (b.min[0] === b.max[0] && b.min[1] === b.max[1]) {
    return { center: b.min, zoom: Math.min(16, 15 + zoomDelta) };
  }
  const cam = map.cameraForBounds([b.min, b.max] as LngLatBoundsLike, {
    padding: FIT_PADDING / previewScale,
    maxZoom: 16,
  });
  if (!cam || typeof cam.zoom !== 'number' || !cam.center) {
    return { center: b.min, zoom: Math.min(16, 15 + zoomDelta) };
  }
  return { center: cam.center, zoom: cam.zoom };
}
