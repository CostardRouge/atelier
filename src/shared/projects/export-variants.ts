/**
 * Export variants — one press of Export can produce several deliverables of
 * the same composition: reframed to another destination aspect, capped to a
 * delivery resolution, with or without the overlays. Pure and DOM-free; the
 * video work lives in shared/media/export-variant.ts.
 *
 * Conventions:
 * - `aspectId: 'source'` keeps the clip's own frame; a preset id (9:16, …)
 *   cover-crops into that frame at the source's pixel density.
 * - `resolution` is the SHORT side (how delivery platforms speak: 1080p
 *   vertical = 1080×1920). 'source' keeps the source density. Never upscales.
 * - `frameRate` is the delivery cadence; 'source' keeps the clip's own and is
 *   the only exact pass-through (see media/frame-rate.ts).
 * - File names are `<base>[-9x16][-1080p][-30fps][-clean].mp4` — suffixes only
 *   where a variant departs from the source, so the plain export keeps a plain
 *   name.
 */

import { ASPECT_PRESETS } from './project-types';
import { even } from '../media/compose-layout';
import { describeFrameRate, type ExportFrameRate } from '../media/frame-rate';

export type VariantAspect = 'source' | string;
export type VariantResolution = 'source' | 1080 | 720;

export interface ExportVariant {
  id: string;
  aspectId: VariantAspect;
  resolution: VariantResolution;
  /** Delivery frame rate; 'source' keeps the clip's own cadence. */
  frameRate: ExportFrameRate;
  /** Burn the overlay elements (and their theme) in, or deliver clean. */
  overlays: boolean;
}

export function createVariant(aspectId: VariantAspect = 'source'): ExportVariant {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `var_${Math.random().toString(36).slice(2)}`,
    aspectId,
    resolution: 'source',
    frameRate: 'source',
    overlays: true,
  };
}

/** The out-of-the-box export: source frame, density and cadence, overlays in. */
export function defaultVariants(): ExportVariant[] {
  return [createVariant('source')];
}

/**
 * Output dimensions for a variant over a `srcW`×`srcH` source (display
 * orientation). Preset aspects cover-crop at the source's pixel density;
 * the resolution caps the short side (never upscaling); both dimensions are
 * forced even for H.264.
 */
export function variantOutputSize(
  variant: ExportVariant,
  srcW: number,
  srcH: number,
): { w: number; h: number } {
  let baseW = srcW;
  let baseH = srcH;
  if (variant.aspectId !== 'source') {
    const preset = ASPECT_PRESETS.find((a) => a.id === variant.aspectId);
    if (preset) {
      const ratio = preset.w / preset.h;
      const short = Math.min(srcW, srcH);
      if (ratio >= 1) {
        baseH = short;
        baseW = short * ratio;
      } else {
        baseW = short;
        baseH = short / ratio;
      }
    }
  }
  if (variant.resolution !== 'source') {
    const shortSide = Math.min(baseW, baseH);
    const scale = Math.min(1, variant.resolution / shortSide);
    baseW *= scale;
    baseH *= scale;
  }
  return { w: even(Math.round(baseW)), h: even(Math.round(baseH)) };
}

/** The name parts a variant appends: only where it departs from the source. */
export function variantSuffix(variant: ExportVariant): string {
  const parts: string[] = [];
  if (variant.aspectId !== 'source') {
    parts.push(variant.aspectId.replace(':', 'x'));
  }
  if (variant.resolution !== 'source') parts.push(`${variant.resolution}p`);
  if (variant.frameRate !== 'source') parts.push(`${variant.frameRate}fps`);
  if (!variant.overlays) parts.push('clean');
  return parts.join('-');
}

/** Final download name: the (custom or project) base plus the suffix. */
export function variantFileName(base: string, variant: ExportVariant): string {
  const cleanBase = base.trim().replace(/\.mp4$/i, '') || 'export';
  const suffix = variantSuffix(variant);
  return suffix ? `${cleanBase}-${suffix}.mp4` : `${cleanBase}.mp4`;
}

/** Human summary for a variant row ("9:16 · 1080p · 30 fps · clean"). */
export function describeVariant(variant: ExportVariant): string {
  const parts = [
    variant.aspectId === 'source' ? 'Source frame' : variant.aspectId,
    variant.resolution === 'source' ? 'source res' : `${variant.resolution}p`,
    describeFrameRate(variant.frameRate),
    variant.overlays ? 'overlays' : 'clean',
  ];
  return parts.join(' · ');
}
