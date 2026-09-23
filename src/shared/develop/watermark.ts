/**
 * A WATERMARK — a line of text drawn on a delivered file (audit item 28, the
 * last of its asks). The STYLE is the roll's (`RollExport.watermark`), one
 * look for a set; WHETHER it is drawn is each target's (`ExportTarget.
 * watermark`), because the copy that goes online is signed and the one kept
 * for the archive is not.
 *
 * The text is a template over the identity the files are already signed with
 * (`exif/delivery-meta.ts`): `{creator}`, `{year}` — the CAPTURE's year, as
 * the copyright line reads it — and `{title}`, the picture's own. A token
 * with nothing to say is dropped with the words around it collapsing; a line
 * that names `{creator}` while no name is set, or is left with nothing but
 * punctuation, is not drawn at all: a lone "© 2025" in a corner signs nothing.
 *
 * Drawn AFTER the screen sharpening (a mark is not detail to bring back) and
 * on both halves of an Ultra HDR file, so its gain stays flat where the text
 * is. Pure and DOM-free; `roll-render.ts` draws it.
 */

export type WatermarkPosition = 'bottom-right' | 'bottom-left' | 'bottom' | 'top-right' | 'top-left';
export type WatermarkTone = 'light' | 'dark';

export interface Watermark {
  /** A template: `{creator}`, `{year}`, `{title}`. */
  text: string;
  position: WatermarkPosition;
  /** The text's height, as a percentage of the file's SHORT side — so a web copy and a full one carry the same mark. */
  size: number;
  /** 0.1..1. */
  opacity: number;
  tone: WatermarkTone;
}

export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = ['bottom-right', 'bottom-left', 'bottom', 'top-right', 'top-left'];

export const WATERMARK_LIMITS = {
  size: { min: 1, max: 8 },
  opacity: { min: 0.1, max: 1 },
} as const;

export const DEFAULT_WATERMARK: Readonly<Watermark> = Object.freeze({
  text: '© {year} {creator}',
  position: 'bottom-right',
  size: 2.5,
  opacity: 0.7,
  tone: 'light',
});

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function readWatermark(raw: unknown): Watermark {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_WATERMARK };
  const src = raw as Record<string, unknown>;
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    text: typeof src.text === 'string' ? src.text.slice(0, 120) : DEFAULT_WATERMARK.text,
    position: WATERMARK_POSITIONS.includes(src.position as WatermarkPosition)
      ? (src.position as WatermarkPosition)
      : DEFAULT_WATERMARK.position,
    size: clamp(n(src.size, DEFAULT_WATERMARK.size), WATERMARK_LIMITS.size.min, WATERMARK_LIMITS.size.max),
    opacity: clamp(n(src.opacity, DEFAULT_WATERMARK.opacity), WATERMARK_LIMITS.opacity.min, WATERMARK_LIMITS.opacity.max),
    tone: src.tone === 'dark' ? 'dark' : 'light',
  };
}

export function sameWatermark(a: Watermark, b: Watermark): boolean {
  return a.text === b.text && a.position === b.position && a.size === b.size && a.opacity === b.opacity && a.tone === b.tone;
}

/**
 * The line one picture carries, or '' for none. A token with nothing behind
 * it goes, and so do the spaces it leaves; a line with no letter or digit
 * left in it is not drawn.
 */
export function resolveWatermarkText(
  template: string,
  values: { creator?: string | null; year?: number | null; title?: string | null },
): string {
  // A line that names its author and has none is not drawn — "© 2025" signs
  // nothing — the rule `resolveRights` keeps for the copyright.
  if (template.includes('{creator}') && !values.creator?.trim()) return '';
  const line = template
    .replace(/\{creator\}/g, values.creator?.trim() ?? '')
    .replace(/\{year\}/g, values.year ? String(values.year) : '')
    .replace(/\{title\}/g, values.title?.trim() ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(line) ? line : '';
}

/** Where the line sits on a `w × h` file: its anchor, its alignment, its height in pixels. */
export interface WatermarkLayout {
  x: number;
  y: number;
  fontPx: number;
  align: 'left' | 'right' | 'center';
  baseline: 'top' | 'bottom';
}

/**
 * The line's place: `size` % of the short side tall, inset from its corner by
 * one line height (never less than 2 % of the short side), so it sits the
 * same on a 1080 px copy and on the full picture.
 */
export function watermarkLayout(w: number, h: number, mark: Pick<Watermark, 'position' | 'size'>): WatermarkLayout {
  const short = Math.min(w, h);
  const fontPx = Math.max(6, Math.round((short * mark.size) / 100));
  const inset = Math.round(Math.max(fontPx, short * 0.02));
  const top = mark.position.startsWith('top');
  const align = mark.position.endsWith('left') ? 'left' : mark.position.endsWith('right') ? 'right' : 'center';
  return {
    x: align === 'left' ? inset : align === 'right' ? w - inset : w / 2,
    y: top ? inset : h - inset,
    fontPx,
    align,
    baseline: top ? 'top' : 'bottom',
  };
}
