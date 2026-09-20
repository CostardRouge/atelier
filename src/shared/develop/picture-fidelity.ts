/**
 * What a picture IS, for the Develop sheet's chip — and the sentence about
 * what it can give back. An 8-bit picture clips at white; only a RAW keeps
 * what the sensor saw above it, and a RAW that has not been opened on its
 * sensor is on screen through the render its camera wrote inside it.
 *
 * It names the BITS and the PIXELS both (2026-09-20). A DJI `dji_fly_*.DNG`
 * carries a 960 × 540 render against an 8064 × 4536 sensor plane — 0.5 of
 * 36.6 megapixels, 8.4× short on the long edge — so "camera render" alone let
 * a picture look pixelated with nothing on screen saying why. The number is
 * the answer, in the idiom the suite already uses: say what is really there,
 * never a figure nobody measured.
 *
 * Shared by Trips, the Studio and the Develop tool: the second consumer is
 * what moved it out of the piece editor (the `StylePanel` rule).
 */

import { isRawImage } from '../library/assets';
import { imageTypeLabel } from '../media/image-meta';
import { mediaOrigin } from '../projects/media-identity';
import { WORKING_PREVIEW_EDGE, isWorkingPreview } from './working-preview';

export interface PictureFidelity {
  /** The chip beside the sheet's title, or null with no picture. */
  chip: string | null;
  /** One line under the picture, or null when there is nothing to warn about. */
  note: string | null;
}

/**
 * The pixels a host has actually measured for the picture it is showing.
 * Absent, every sentence below is exactly what it was before the size was
 * said — a host that has not decoded yet claims nothing.
 */
export interface FidelityPixels {
  /** What was decoded, and is on screen. */
  width: number;
  height: number;
  /**
   * True when those pixels are the JPEG a camera wrote INSIDE a RAW rather
   * than the file's own — `DecodedPhoto.viaRawPreview`, which until now was
   * returned by `photo-frame.ts` and read by nobody.
   */
  viaRawPreview?: boolean;
  /**
   * The pixels the FILE itself holds, when a source or a probe knows them and
   * they are larger: a proxy's original, a RAW's sensor plane. What makes the
   * shortfall sayable rather than merely suspected.
   */
  full?: { width: number; height: number } | null;
}

/** `36.6` for an 8064 × 4536 plane — one decimal, always, so a column lines up. */
export function megapixels(width: number, height: number): number {
  return (width * height) / 1e6;
}

/** `8064 × 4536 · 36.6 MP`, or null when nothing was measured. */
export function pixelsLabel(pixels: { width: number; height: number } | null | undefined): string | null {
  if (!pixels || pixels.width <= 0 || pixels.height <= 0) return null;
  return `${pixels.width} × ${pixels.height} · ${megapixels(pixels.width, pixels.height).toFixed(1)} MP`;
}

/**
 * How far what is on screen falls short of what the file holds:
 * `8.4× short on the long edge of its 8064 × 4536`. Null when the two are the
 * same picture — or when the shown pixels already reach it, which is the
 * ordinary case and deserves no sentence at all.
 */
export function shortfallLabel(
  shown: { width: number; height: number },
  full: { width: number; height: number } | null | undefined,
): string | null {
  if (!full || full.width <= 0 || full.height <= 0 || shown.width <= 0) return null;
  const shownLong = Math.max(shown.width, shown.height);
  const fullLong = Math.max(full.width, full.height);
  if (fullLong <= shownLong * 1.02) return null;
  return `${(fullLong / shownLong).toFixed(1)}× short on the long edge of its ${full.width} × ${full.height}`;
}

/** `· 960 × 540`, for a chip; empty when nothing was measured. */
function chipPixels(pixels: FidelityPixels | null | undefined): string {
  return pixels && pixels.width > 0 && pixels.height > 0 ? ` · ${pixels.width} × ${pixels.height}` : '';
}

/** The size and the shortfall as one clause, for a note; empty when neither is known. */
function sizeClause(pixels: FidelityPixels | null | undefined): string {
  const label = pixelsLabel(pixels);
  if (!label) return '';
  const short = pixels ? shortfallLabel(pixels, pixels.full) : null;
  return short ? ` — ${label}, ${short}` : ` — ${label}`;
}

/**
 * `base` is the material the develop acts on: on `raw` the picture on screen
 * is the SENSOR's data decoded to linear light (`shared/raw/`), whatever the
 * file in hand is — a local DNG, or a proxy whose RAW original was fetched.
 *
 * `pixels` is what the host measured, and is optional on purpose: the
 * sentence never invents a size it was not given.
 */
export function pictureFidelity(
  file: File | null,
  base: 'render' | 'raw' | null | undefined = null,
  pixels: FidelityPixels | null = null,
): PictureFidelity {
  if (!file) return { chip: null, note: null };
  if (base === 'raw') {
    return {
      chip: `RAW · 16-bit linear${chipPixels(pixels)}`,
      note: `the sensor’s own data, decoded to linear light: what it kept above the displayed white is here to bring back${sizeClause(pixels)}`,
    };
  }
  if (isWorkingPreview(file)) {
    return {
      chip: `working preview · ${WORKING_PREVIEW_EDGE}${chipPixels(pixels)}`,
      note: `its working preview, ${WORKING_PREVIEW_EDGE} px at most — reopen its folder to develop and export the file itself${sizeClause(pixels)}`,
    };
  }
  const origin = mediaOrigin(file);
  if (origin?.fidelity === 'proxy') {
    return {
      chip: `proxy · 8-bit${chipPixels(pixels)}`,
      note: `an 8-bit proxy from ${origin.sourceId}: highlights above white are already gone here${sizeClause(pixels)}`,
    };
  }
  // BEFORE the media-type test: a RAW off a disk usually carries an empty
  // type, so asking the type first called every DNG a clip. It is on screen at
  // all only through the render its camera wrote inside it
  // (`shared/exif/raw-probe.ts`), and "8-bit" alone would let that pass for
  // the file's own pixels — as would the render's size with nothing to
  // measure it against, which is why the sensor's own goes in `full`.
  if (isRawImage(file.name) || pixels?.viaRawPreview) {
    const size = pixelsLabel(pixels);
    const short = pixels ? shortfallLabel(pixels, pixels.full) : null;
    const measured = size ? `${size}${short ? `, ${short}` : ''} — and 8-bit` : '8-bit';
    return {
      chip: `${imageTypeLabel(file.name)} · camera render${chipPixels(pixels)}`,
      note: `the JPEG your camera wrote inside the RAW, not the sensor data: ${measured}, so highlights above white are already gone from it`,
    };
  }
  if (!file.type.startsWith('image/')) return { chip: `clip · 8-bit${chipPixels(pixels)}`, note: null };
  return {
    chip: `${imageTypeLabel(file.name)} · 8-bit${chipPixels(pixels)}`,
    note: `an 8-bit picture: highlights above white are already gone${sizeClause(pixels)}`,
  };
}
