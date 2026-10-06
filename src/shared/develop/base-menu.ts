/**
 * The FIGURES of the name menu (`DevelopBase.tsx`), worked out once and
 * tested: which group a row sits in, and the few numbers it shows — its
 * megapixels in the right-hand column, its size, its bit depth and how far it
 * falls short of the biggest picture the capture holds.
 *
 * The menu became three groups (2026-10-06, his pick of face B in the
 * Renditions Drawer lab, "with the MP number"): the proxy, the camera's file,
 * the sensor. A row reads at a glance — a title, its megapixels, one line of
 * facts — and the sentence about what it IS is said once, on the row that is
 * open. Pure and DOM-free; nothing here is drawn.
 */

import { isClipName } from '../library/assets';
import type { PixelSize, Rendition, RenditionRole } from '../media/renditions';
import { megapixels } from './picture-fidelity';

/** A run of rows sharing a role, in the order the menu draws them. */
export interface RenditionGroup {
  role: RenditionRole;
  rows: Rendition[];
}

const ORDER: readonly RenditionRole[] = ['proxy', 'delivered', 'sensor'];

/** The capture's rows by role, proxy first, empty groups left out. Order inside a group is kept. */
export function groupRenditions(rows: readonly Rendition[]): RenditionGroup[] {
  return ORDER.map((role) => ({ role, rows: rows.filter((r) => r.role === role) })).filter((g) => g.rows.length > 0);
}

/** The biggest picture any row of the capture was measured at — what a shortfall is counted against. */
export function fullPixels(rows: readonly Rendition[]): PixelSize | null {
  let best: PixelSize | null = null;
  for (const row of rows) {
    const p = row.pixels;
    if (p && p.width > 0 && p.height > 0 && (!best || p.width * p.height > best.width * best.height)) best = p;
  }
  return best;
}

/** `36.6 MP`, one decimal so a column lines up; null when nobody measured the row. */
export function megapixelsLabel(pixels: PixelSize | null | undefined): string | null {
  if (!pixels || pixels.width <= 0 || pixels.height <= 0) return null;
  return `${megapixels(pixels.width, pixels.height).toFixed(1)} MP`;
}

/**
 * `8.4× short`, against the capture's biggest picture on the long edge — only
 * from 1.5× on, where it is a picture you can SEE is softer; null otherwise.
 */
export function shortOf(pixels: PixelSize | null | undefined, full: PixelSize | null): string | null {
  if (!pixels || !full || pixels.width <= 0 || pixels.height <= 0) return null;
  const ratio = Math.max(full.width, full.height) / Math.max(pixels.width, pixels.height);
  return ratio >= 1.5 ? `${ratio.toFixed(1)}× short` : null;
}

export interface RowFigures {
  /** The right-hand column: `36.6 MP`, or null. */
  megapixels: string | null;
  /** `8064 × 4536`, or null. */
  size: string | null;
  /** `8-bit` for a picture, `16-bit linear` for the sensor; null for a clip. */
  depth: string | null;
  /** `8.4× short`, or null. */
  short: string | null;
}

export function rowFigures(row: Rendition, full: PixelSize | null): RowFigures {
  const clip = isClipName(row.name);
  return {
    megapixels: megapixelsLabel(row.pixels),
    size: row.pixels ? `${row.pixels.width} × ${row.pixels.height}` : null,
    depth: clip ? null : row.role === 'sensor' ? '16-bit linear' : '8-bit',
    // The sensor IS the full picture; a row is short only against it or a bigger file.
    short: row.role === 'sensor' ? null : shortOf(row.pixels, full),
  };
}
