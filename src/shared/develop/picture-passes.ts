/**
 * The PASS CHAIN a picture's settings ask for, on either side of its cube —
 * ONE function for a roll's delivery, its darker HDR twin, every state of a
 * making-of video (`docs/develop-timelapse.md` §3.4) and, since item 34 of
 * `docs/lightroom-gaps.md`, the edit a Develop picture CARRIES into Trips and
 * the Studio (`carried-edit.ts`), so a render is never assembled two ways.
 *
 * Its own module, apart from `roll-render.ts`, because a host that only draws
 * a picture must not take the roll's whole export with it — the decoders, the
 * encoders, the HDR container. `roll-render.ts` re-exports both names.
 */

import type { Framing } from '../media/framing';
import type { RenderPass } from '../render/graph';
import type { BrushRaster } from '../render/brush-raster';
import { detailPasses } from '../render/detail-pass';
import type { DetailSettings } from '../render/detail';
import { makeGainMapPass } from '../render/gain-map-pass';
import type { GainField } from '../render/gain-map';
import type { CameraWarp } from '../render/camera-warp';
import type { Keystone } from '../render/geometry';
import type { LensCorrection, LensProfileTerms } from '../render/lens';
import { geometryPasses } from '../render/picture-geometry';
import type { PostCropVignette } from '../render/post-vignette';
import type { Patch } from '../render/repair';
import { makeRepairPass } from '../render/repair-pass';
import { pictureAspectRatio } from './crop-aspect';
import type { AdjustLayer } from './layer';
import { layerPasses } from './layer-render';
import { postVignettePass } from './vignette-frame';

/** What a picture's pass chain is built from: its settings, on either side of its cube. */
export interface PassSettings {
  /** The crop's framing and aspect — read by the post-crop vignette alone, which is shaped in the frame they cut. */
  framing: Framing | null;
  aspect: string;
  keystone?: Keystone | null;
  lens?: LensCorrection | null;
  lensProfile?: LensProfileTerms | null;
  layers?: readonly AdjustLayer[] | null;
  detail?: DetailSettings | null;
  repair?: readonly Patch[] | null;
  vignette?: PostCropVignette | null;
  /** The camera's own calibration — read on the RAW path only. */
  calibration?: { gain: GainField | null; warp: CameraWarp | null } | null;
}

export interface PicturePasses {
  /** BEFORE the cube, on the source: the camera's shading (RAW), the repair, the noise passes. */
  pre: RenderPass[];
  /** AFTER it: the geometry, the layers with their rasters, the sharpen, the post-crop vignette. */
  passes: RenderPass[];
}

/**
 * The chain. `raw` says which path this is: the sensor's data takes the
 * camera's own calibration — its shading grid FIRST of all, ahead of the
 * repair (`render-gain-map.md`), and its warp in the geometry — while a render
 * or a proxy has had both applied by the camera, and applying them twice
 * would lift the corners into white. `scale` is the decode's density over the
 * source's (the file's, the sensor's): kernels are stated in SOURCE pixels.
 * Only the aspect reaches the vignette: its map is in [0,1] and asks for no
 * size. A pass holds textures on the context it first drew on, so every
 * grader takes a chain of its own.
 */
export function picturePasses(
  opts: PassSettings,
  ar: number,
  scale: number,
  rasters: ReadonlyMap<string, BrushRaster> | null,
  raw: boolean,
): PicturePasses {
  // Noise and fringe BEFORE the cube, on the source; sharpen AFTER every warp
  // and layer, so nothing resamples it (`detail.ts`, «Order»). Repair FIRST, on
  // the source: a copied pixel then takes the same develop, look, warp and
  // layer as its neighbours, and a denoise sees a repaired picture.
  const { pre: detailPre, post } = detailPasses(opts.detail, scale);
  const repairPass = makeRepairPass(opts.repair ?? [], ar);
  const gainPass = raw ? makeGainMapPass(opts.calibration?.gain) : null;
  const geometry = raw ? { ...opts, cameraWarp: opts.calibration?.warp ?? null } : opts;
  return {
    pre: [...(gainPass ? [gainPass] : []), ...(repairPass ? [repairPass] : []), ...detailPre],
    passes: [
      ...geometryPasses(geometry, ar),
      ...layerPasses(opts.layers, ar, undefined, rasters),
      ...post,
      ...vignettePasses(opts, { width: ar, height: 1 }),
    ],
  };
}

/**
 * The post-crop vignette for this delivery, in the frame its crop cuts —
 * after the sharpen, as the stage draws it. One place, so the SDR base and
 * the HDR rendition cannot be vignetted differently.
 */
export function vignettePasses(opts: Pick<PassSettings, 'aspect' | 'framing' | 'vignette'>, source: { width: number; height: number }): RenderPass[] {
  const ratio = pictureAspectRatio(opts.aspect, source.width, source.height);
  const pass = postVignettePass(opts.vignette, source.width, source.height, ratio, opts.framing);
  return pass ? [pass] : [];
}
