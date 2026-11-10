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

/**
 * Where a cell's number — its DATE since lab 17 — sits: a corner, the
 * middle, or `foot`, a soft band low over the picture where a long date has
 * room (a highlight's, never a calendar cell's).
 */
export type NumberAt = 'topLeft' | 'topRight' | 'centre' | 'bottomLeft' | 'foot';
export const NUMBER_PLACES: readonly NumberAt[] = ['topLeft', 'topRight', 'centre', 'bottomLeft'];
export const DATE_PLACES: readonly NumberAt[] = [...NUMBER_PLACES, 'foot'];

/**
 * How a cell's date reads (lab 17 part I, his yes of 2026-11-10), drawn on
 * Monday 10 November 2025: `d` 10 · `wd` Mon 10 · `dMon` 10 Nov · `wdMon` Mon
 * 10 Nov · `full` Monday 10 November 2025 · `rank` the picture's place in the
 * carousel (3). `auto` is what a cell always printed — the day of the month on
 * a calendar or a week, the rank elsewhere — so a recap made before reads the
 * same. Hidden is `number: false`, as it always was.
 */
export type DateFormat = 'auto' | 'd' | 'wd' | 'dMon' | 'wdMon' | 'full' | 'rank';
export const DATE_FORMATS: readonly DateFormat[] = ['auto', 'd', 'wd', 'dMon', 'wdMon', 'full', 'rank'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A day (`YYYY-MM-DD`) in a format; `number` is what the cell prints for `auto` and `rank`, and when it has no day. */
export function cellDate(day: string | null | undefined, format: DateFormat, number: string): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m || format === 'auto' || format === 'rank') return number;
  const d = Number(m[3]);
  const month = MONTHS[Number(m[2]) - 1] ?? '';
  const wd = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, d)).getUTCDay()];
  switch (format) {
    case 'd':
      return String(d);
    case 'wd':
      return `${wd.slice(0, 3)} ${d}`;
    case 'dMon':
      return `${d} ${month.slice(0, 3)}`;
    case 'wdMon':
      return `${wd.slice(0, 3)} ${d} ${month.slice(0, 3)}`;
    default:
      return `${wd} ${d} ${month} ${m[1]}`;
  }
}

/**
 * What a cell SAYS — the settings a scope may own (lab 17 part I): the
 * calendar (the first slide) in `cells`, the highlights as a family in
 * `carousel.cells`, one slide in `carousel.slideCells[key]`, each merged over
 * the one before (`recap-scope.ts`).
 */
export interface CellWords {
  number: boolean;
  date: DateFormat;
  numberAt: NumberAt;
  count: boolean;
  exif: boolean;
  device: boolean;
  caption: boolean;
  exifParts: ExifPart[];
  arrange: Arrange;
}
export const WORD_KEYS: readonly (keyof CellWords)[] = ['number', 'date', 'numberAt', 'count', 'exif', 'device', 'caption', 'exifParts', 'arrange'];

/** A scope's own words, read from anything: what it does not say, it inherits. */
export function readWords(raw: unknown): Partial<CellWords> {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Partial<CellWords> = {};
  for (const k of ['number', 'count', 'exif', 'device', 'caption'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (DATE_FORMATS.includes(r.date as DateFormat)) out.date = r.date as DateFormat;
  if (DATE_PLACES.includes(r.numberAt as NumberAt)) out.numberAt = r.numberAt as NumberAt;
  if (ARRANGES.includes(r.arrange as Arrange)) out.arrange = r.arrange as Arrange;
  const parts = readExifParts(r.exifParts);
  if (parts) out.exifParts = parts;
  return out;
}

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

/**
 * A slide's days as a running head says them (lab 17): «3 – 8 Nov», «Mon 3 –
 * Sat 8 Nov», one day alone as itself, across a month «30 Oct – 2 Nov». A
 * format that prints no date (`auto`, `rank`) reads as `dMon`.
 */
export function daysRange(days: readonly string[], format: DateFormat): string {
  const sorted = [...new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!sorted.length) return '';
  const f: DateFormat = format === 'auto' || format === 'rank' ? 'dMon' : format;
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  if (a === b) return cellDate(a, f, '');
  if (f === 'd') return `${Number(a.slice(8))} – ${Number(b.slice(8))}`;
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  // Within a month the first day drops its month: «3 – 8 Nov», «Mon 3 – Sat 8 Nov»; the full form keeps both whole.
  const start = f === 'full' ? cellDate(a, 'wdMon', '') : sameMonth ? cellDate(a, f === 'dMon' ? 'd' : 'wd', '') : cellDate(a, f === 'wd' ? 'wdMon' : f, '');
  const end = f === 'full' ? cellDate(b, 'full', '') : cellDate(b, f === 'wd' ? 'wdMon' : f, '');
  return `${start} – ${end}`;
}
