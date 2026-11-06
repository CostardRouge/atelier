/**
 * The words a cell writes over its picture — the camera's settings above all
 * — and how they hold INSIDE it (his report, 2026-11-05: on a photo dump the
 * camera line ran past its cell). Three rules:
 *
 * - **What**: the settings shown are chosen (`ExifPart`), for the whole recap
 *   and, when wanted, per picture.
 * - **How**: one line, stacked one per line, or *auto* — packed into as few
 *   lines as fit, and stacked in a tall cell.
 * - **Never past the cell**: a line too long shrinks a little, then ends in
 *   an ellipsis; lines past the cell's height are left out.
 *
 * Pure: the painter hands in a `measure` for its own font.
 */

// Types only: `recap-doc.ts` reads its defaults from here.
import type { RecapPicture } from './recap-doc';

export type ExifPart = 'device' | 'lens' | 'focal' | 'aperture' | 'shutter' | 'iso';
export const EXIF_PARTS: readonly ExifPart[] = ['device', 'lens', 'focal', 'aperture', 'shutter', 'iso'];
export const EXIF_LABEL: Record<ExifPart, string> = { device: 'Device', lens: 'Lens', focal: 'Focal', aperture: 'Aperture', shutter: 'Shutter', iso: 'ISO' };
/** What the camera line said before it could be chosen: everything but the lens. */
export const DEFAULT_EXIF_PARTS: readonly ExifPart[] = ['device', 'focal', 'aperture', 'shutter', 'iso'];

export type Arrange = 'auto' | 'line' | 'stack';
export const ARRANGES: readonly Arrange[] = ['auto', 'line', 'stack'];

/** A list of parts read from anything, in the canonical order, duplicates and strangers dropped; null when not a list. */
export function readExifParts(raw: unknown): ExifPart[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set(raw.filter((v): v is ExifPart => EXIF_PARTS.includes(v as ExifPart)));
  return EXIF_PARTS.filter((p) => set.has(p));
}

/** Each chosen setting the picture knows, as it reads: `α7 IV`, `35 mm`, `f/1.8`, `1/250`, `ISO 100`. `named` says a device (its alias). */
export function exifBits(p: RecapPicture, parts: readonly ExifPart[], named: (device: string) => string = (d) => d): string[] {
  const out: string[] = [];
  for (const part of EXIF_PARTS) {
    if (!parts.includes(part)) continue;
    if (part === 'device' && p.device) out.push(named(p.device));
    else if (part === 'lens' && p.lens) out.push(p.lens);
    else if (part === 'focal' && p.focal) out.push(`${Math.round(p.focal)} mm`);
    else if (part === 'aperture' && p.fNumber) out.push(`f/${p.fNumber % 1 ? p.fNumber.toFixed(1) : p.fNumber}`);
    else if (part === 'shutter' && p.shutter) out.push(p.shutter);
    else if (part === 'iso' && p.iso) out.push(`ISO ${p.iso}`);
  }
  return out;
}

export const JOIN = ' · ';

/**
 * The lines `bits` take in a cell `maxW` wide: one joined line, one per line,
 * or — `auto` — packed greedily into lines that fit, every bit on its own line
 * in a tall cell. At most `maxLines`; a line still too long is `fitText`'s.
 */
export function arrangeBits(bits: readonly string[], arrange: Arrange, maxW: number, measure: (s: string) => number, tall: boolean, maxLines = Infinity): string[] {
  if (!bits.length) return [];
  let lines: string[];
  if (arrange === 'line') lines = [bits.join(JOIN)];
  else if (arrange === 'stack' || tall) lines = [...bits];
  else {
    lines = [];
    let cur = '';
    for (const b of bits) {
      const next = cur ? cur + JOIN + b : b;
      if (cur && measure(next) > maxW) {
        lines.push(cur);
        cur = b;
      } else cur = next;
    }
    if (cur) lines.push(cur);
  }
  return lines.slice(0, Math.max(1, Math.floor(maxLines)));
}

/**
 * A line held inside `maxW`: as it is when it fits, else shrunk down to
 * `minScale`, else cut with an ellipsis at that scale. `measure` reads the
 * text at scale 1.
 */
export function fitText(value: string, maxW: number, measure: (s: string) => number, minScale = 0.75): { text: string; scale: number } {
  const w = measure(value);
  if (w <= maxW || maxW <= 0) return { text: value, scale: 1 };
  const scale = Math.max(minScale, maxW / w);
  if (w * scale <= maxW + 0.01) return { text: value, scale };
  // Cut: the longest head that fits with its ellipsis, at the smallest scale.
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(value.slice(0, mid).trimEnd() + '…') * minScale <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return { text: lo > 0 ? value.slice(0, lo).trimEnd() + '…' : '…', scale: minScale };
}
