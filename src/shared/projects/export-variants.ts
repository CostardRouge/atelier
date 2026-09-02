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
 * - `speed` is the delivered speed (1 = as shot). It changes the DURATION, not
 *   the cadence — and a re-timed variant ships silent, because the audio is
 *   copied, never re-encoded.
 * - File names are `<base>[-9x16][-1080p][-30fps][-clean].mp4` — suffixes only
 *   where a variant departs from the source, so the plain export keeps a plain
 *   name.
 */

import { ASPECT_PRESETS } from './project-types';
import { even } from '../media/compose-layout';
import {
  describeFrameRate,
  describeSpeed,
  resolveSpeed,
  speedSuffix,
  type ExportFrameRate,
} from '../media/frame-rate';

export type VariantAspect = 'source' | string;
export type VariantResolution = 'source' | 1080 | 720;

export interface ExportVariant {
  id: string;
  aspectId: VariantAspect;
  resolution: VariantResolution;
  /** Delivery frame rate; 'source' keeps the clip's own cadence. */
  frameRate: ExportFrameRate;
  /** Delivered speed; 1 keeps the clip's own. Re-timed variants have no audio. */
  speed: number;
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
    speed: 1,
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
/**
 * The gap between what a variant ASKS for and what the source can give, or
 * null when it gets what it asked for.
 *
 * `variantOutputSize` never upscales — its scale is `min(1, …)` — so a variant
 * set to 1080 over a 720p source quietly delivers 720. Quietly is the problem:
 * the row says 1080p, the file is not, and nothing on screen admits it. This
 * is the fact the export panel states, and (for a source that is a remote
 * proxy) the reason it offers the capture instead.
 */
export function resolutionShortfall(
  variant: ExportVariant,
  srcW: number,
  srcH: number,
): { asked: number; delivered: number } | null {
  if (variant.resolution === 'source' || !srcW || !srcH) return null;
  const out = variantOutputSize(variant, srcW, srcH);
  const delivered = Math.min(out.w, out.h);
  return delivered < variant.resolution
    ? { asked: variant.resolution, delivered }
    : null;
}

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

/**
 * What a variant is rendering. A still uses the same {@link ExportVariant} —
 * an aspect to reframe into, a resolution to cap at, overlays on or off — but
 * cadence and speed are meaningless over one frame, so they take no part in
 * its name and no part in its render.
 */
export type VariantMedium = 'video' | 'photo';

/** File extension a medium delivers in. */
export const MEDIUM_EXTENSION: Record<VariantMedium, string> = {
  video: 'mp4',
  photo: 'jpg',
};

/** The name parts a variant appends: only where it departs from the source. */
export function variantSuffix(
  variant: ExportVariant,
  medium: VariantMedium = 'video',
): string {
  const parts: string[] = [];
  if (variant.aspectId !== 'source') {
    parts.push(variant.aspectId.replace(':', 'x'));
  }
  if (variant.resolution !== 'source') parts.push(`${variant.resolution}p`);
  if (medium === 'video') {
    if (variant.frameRate !== 'source') parts.push(`${variant.frameRate}fps`);
    const speed = speedSuffix(variant.speed);
    if (speed) parts.push(speed);
  }
  if (!variant.overlays) parts.push('clean');
  return parts.join('-');
}

/** Final download name: the (custom or project) base plus the suffix. */
export function variantFileName(
  base: string,
  variant: ExportVariant,
  medium: VariantMedium = 'video',
): string {
  const ext = MEDIUM_EXTENSION[medium];
  // Strip any delivery extension the base already carries, whichever medium
  // it named: the file name is a project setting, and stepping from a clip to
  // a still inside one project must not produce `shot.mp4.jpg`.
  const cleanBase = base.trim().replace(/\.(mp4|jpe?g)$/i, '') || 'export';
  const suffix = variantSuffix(variant, medium);
  return suffix ? `${cleanBase}-${suffix}.${ext}` : `${cleanBase}.${ext}`;
}

/** True when this variant re-times, and therefore delivers without audio. */
export function variantIsRetimed(variant: ExportVariant): boolean {
  return resolveSpeed(variant.speed) !== 1;
}

/** Human summary for a variant row ("9:16 · 1080p · 30 fps · 2× speed · clean"). */
export function describeVariant(
  variant: ExportVariant,
  medium: VariantMedium = 'video',
): string {
  const parts = [
    variant.aspectId === 'source' ? 'Source frame' : variant.aspectId,
    variant.resolution === 'source' ? 'source res' : `${variant.resolution}p`,
    medium === 'video' ? describeFrameRate(variant.frameRate) : null,
    medium === 'video' ? describeSpeed(variant.speed) : null,
    variant.overlays ? 'overlays' : 'clean',
  ].filter(Boolean);
  return parts.join(' · ');
}
