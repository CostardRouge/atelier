/**
 * Where a roll's export goes, and at what size: its TARGETS (audit item 28,
 * `docs/lightroom-gaps.md`). One run can write the same pictures several
 * ways — the full picture for the archive, a 2048 px set for the web, a
 * 1080 px set for a feed — each picture rendered ONCE and delivered to every
 * target from that one render (`roll-render.ts`).
 *
 * **Names never change.** The maintainer pairs a source folder and a Gallery
 * folder by NAME (`develop-roll.md`, «A DELIVERED picture is named EXACTLY
 * after the picture it came from»), so a second target cannot add a suffix to
 * the file. The FIRST target writes into the folder chosen at the click; every
 * other one writes into a sub-folder of it named after the target
 * (`Web/DJI_0101.jpg`). Only a download — the browser without a folder
 * picker — cannot make a folder, and there the target's name goes before the
 * file's (`Web-DJI_0101.jpg`), said in the panel.
 *
 * A size is a CAP, like the long edge always was: it is read against the
 * picture's own delivered frame and never upscales.
 *
 * - **long** — the long edge, in pixels.
 * - **short** — the short edge: a feed that wants 1080 across a portrait.
 * - **megapixels** — the area, whatever the shape.
 * - **percent** — of the picture's own delivered size.
 *
 * Pure and DOM-free.
 */

export type SizeMode = 'long' | 'short' | 'megapixels' | 'percent';

export interface ExportSize {
  mode: SizeMode;
  value: number;
}

/**
 * Sharpening for the SCREEN, applied to the delivered file after it is
 * resized (`output-sharpen.ts`) — Lightroom's *Output Sharpening*: a resize
 * softens, and the amount that brings it back depends on the size delivered,
 * so it belongs to the target and never to the picture.
 */
export type OutputSharpen = 'off' | 'low' | 'standard' | 'high';

export const OUTPUT_SHARPEN_LEVELS: readonly OutputSharpen[] = ['off', 'low', 'standard', 'high'];

export interface ExportTarget {
  /**
   * The sub-folder it writes into — ignored for the first target, which
   * writes into the chosen folder itself. Also how the panel names it.
   */
  name: string;
  /** Null is the picture's own size. */
  size: ExportSize | null;
  /** JPEG quality, 0.5..1. */
  quality: number;
  sharpen: OutputSharpen;
}

/** A run writes each picture this many times at most — each target is one more encode. */
export const MAX_TARGETS = 4;

export const SIZE_LIMITS: Readonly<Record<SizeMode, { min: number; max: number }>> = {
  long: { min: 256, max: 16384 },
  short: { min: 128, max: 16384 },
  megapixels: { min: 0.1, max: 200 },
  percent: { min: 5, max: 100 },
};

export const QUALITY_LIMITS = { min: 0.5, max: 1 } as const;

export const DEFAULT_TARGET: Readonly<ExportTarget> = Object.freeze({
  name: '',
  size: null,
  quality: 0.92,
  sharpen: 'off',
});

/**
 * The targets a run can start from — Lightroom's export presets, the ones a
 * photographer reaches for. A target added from one is an ordinary target
 * afterwards, every field its own.
 */
export const TARGET_PRESETS: readonly { id: string; label: string; target: ExportTarget }[] = [
  { id: 'full', label: 'Full size', target: { name: 'Full', size: null, quality: 0.92, sharpen: 'off' } },
  { id: 'web', label: 'Web · 2048 px', target: { name: 'Web', size: { mode: 'long', value: 2048 }, quality: 0.85, sharpen: 'standard' } },
  { id: 'feed', label: 'Feed · 1080 px across', target: { name: 'Feed', size: { mode: 'short', value: 1080 }, quality: 0.9, sharpen: 'standard' } },
  { id: 'mail', label: 'Mail · 2 MP', target: { name: 'Mail', size: { mode: 'megapixels', value: 2 }, quality: 0.8, sharpen: 'low' } },
  { id: 'half', label: 'Half · 50 %', target: { name: 'Half', size: { mode: 'percent', value: 50 }, quality: 0.9, sharpen: 'low' } },
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * The long edge a size asks of a delivered frame `frame` (its full size, no
 * cap), or null for no cap. Never MORE than the frame's own long edge: a size
 * is a ceiling, and a small picture asked for a large one delivers what it
 * has.
 */
export function longEdgeFor(size: ExportSize | null | undefined, frame: { w: number; h: number }): number | null {
  if (!size) return null;
  const long = Math.max(frame.w, frame.h);
  const short = Math.min(frame.w, frame.h);
  if (!(long > 0) || !(short > 0)) return null;
  const ratio = long / short;
  let asked: number;
  if (size.mode === 'short') asked = size.value * ratio;
  else if (size.mode === 'megapixels') asked = Math.sqrt(size.value * 1e6 * ratio);
  else if (size.mode === 'percent') asked = (long * size.value) / 100;
  else asked = size.value;
  const edge = Math.round(asked);
  return edge >= long ? null : Math.max(1, edge);
}

/**
 * The long edge a decode must at least hold for these targets, known before
 * the picture is: the largest `long` asked, or null (decode whole) as soon as
 * one target's size depends on the picture's own shape or size.
 */
export function decodeEdgeFor(targets: readonly ExportTarget[]): number | null {
  let edge = 0;
  for (const t of targets) {
    if (!t.size || t.size.mode !== 'long') return null;
    edge = Math.max(edge, t.size.value);
  }
  return edge || null;
}

/**
 * The size that asks the MOST of a picture among these targets, for the one
 * question a run asks before it renders — is the original worth fetching? —
 * since every target is cut from the one render. Full size wins outright; a
 * percentage is as large as its share; between two edges or areas, the one
 * read against a 3:2 frame is larger.
 */
export function largestSize(targets: readonly ExportTarget[]): ExportSize | null {
  if (targets.length === 0 || targets.some((t) => !t.size)) return null;
  const probe = { w: 6000, h: 4000 };
  let best: ExportSize | null = null;
  let edge = -1;
  for (const t of targets) {
    const e = longEdgeFor(t.size, probe) ?? Infinity;
    if (e > edge) {
      edge = e;
      best = t.size;
    }
  }
  return edge === Infinity ? null : best;
}

/** `2048 px long edge` · `1080 px across` · `2 MP` · `50 %` · `full size`. */
export function describeSize(size: ExportSize | null | undefined): string {
  if (!size) return 'full size';
  if (size.mode === 'short') return `${Math.round(size.value)} px short edge`;
  if (size.mode === 'megapixels') return `${+size.value.toFixed(1)} MP`;
  if (size.mode === 'percent') return `${Math.round(size.value)} %`;
  return `${Math.round(size.value)} px long edge`;
}

/** `Web · 2048 px long edge · 85 % · sharpened for screen` — one target, as a line says it. */
export function describeTarget(t: ExportTarget, first: boolean): string {
  const where = first ? 'this folder' : `${targetFolder(t.name, 1)}/`;
  const sharp = t.sharpen === 'off' ? '' : ` · ${t.sharpen} screen sharpening`;
  return `${where} · ${describeSize(t.size)} · ${Math.round(t.quality * 100)} %${sharp}`;
}

/**
 * The sub-folder a target writes into: its name made safe for a file system
 * (no separators, no leading dot, nothing a volume refuses), else `Target 2`.
 */
export function targetFolder(name: string, index: number): string {
  const safe = [...name]
    // A control character is refused by every volume; code points, not a
    // regex, so the rule reads as what it is.
    .map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
    .join('')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 64)
    .trim();
  return safe || `Target ${index + 1}`;
}

/** The size read back safely, or null for the picture's own. */
export function readSize(raw: unknown): ExportSize | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const mode = src.mode;
  if (mode !== 'long' && mode !== 'short' && mode !== 'megapixels' && mode !== 'percent') return null;
  const v = finite(src.value, NaN);
  if (!Number.isFinite(v)) return null;
  const { min, max } = SIZE_LIMITS[mode];
  const value = clamp(v, min, max);
  return { mode, value: mode === 'megapixels' ? Math.round(value * 10) / 10 : Math.round(value) };
}

export function readTarget(raw: unknown): ExportTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  return {
    name: typeof src.name === 'string' ? src.name.slice(0, 64) : '',
    size: readSize(src.size),
    quality: clamp(finite(src.quality, DEFAULT_TARGET.quality), QUALITY_LIMITS.min, QUALITY_LIMITS.max),
    sharpen: OUTPUT_SHARPEN_LEVELS.includes(src.sharpen as OutputSharpen) ? (src.sharpen as OutputSharpen) : 'off',
  };
}

/**
 * A stored list read back: junk dropped, capped, never empty. A roll written
 * before targets existed (v5 and earlier) had ONE long edge and one quality —
 * `legacy` — which become its only target, so it exports exactly as it did.
 */
export function readTargets(raw: unknown, legacy?: { longEdge?: unknown; quality?: unknown }): ExportTarget[] {
  const read = Array.isArray(raw) ? raw.flatMap((t) => readTarget(t) ?? []).slice(0, MAX_TARGETS) : [];
  if (read.length) return read;
  const edge = finite(legacy?.longEdge, NaN);
  return [
    {
      ...DEFAULT_TARGET,
      size: Number.isFinite(edge) ? readSize({ mode: 'long', value: edge }) : null,
      quality: clamp(finite(legacy?.quality, DEFAULT_TARGET.quality), QUALITY_LIMITS.min, QUALITY_LIMITS.max),
    },
  ];
}

export function sameTarget(a: ExportTarget, b: ExportTarget): boolean {
  return (
    a.name === b.name &&
    a.quality === b.quality &&
    a.sharpen === b.sharpen &&
    (a.size === b.size || (!!a.size && !!b.size && a.size.mode === b.size.mode && a.size.value === b.size.value))
  );
}

/**
 * The same size re-expressed in another mode for a frame of this shape, so a
 * mode switch keeps roughly the picture asked for rather than jumping to a
 * default — `2048 long` on a 3:2 becomes `1365 short`.
 */
export function convertSize(size: ExportSize | null, mode: SizeMode, frame: { w: number; h: number } = { w: 3, h: 2 }): ExportSize {
  const long = Math.max(frame.w, frame.h);
  const short = Math.min(frame.w, frame.h);
  const ratio = long > 0 && short > 0 ? long / short : 1.5;
  const edge = size ? size.mode === 'long' ? size.value : size.mode === 'short' ? size.value * ratio : size.mode === 'megapixels' ? Math.sqrt(size.value * 1e6 * ratio) : null : null;
  const fallback: Record<SizeMode, number> = { long: 2048, short: 1080, megapixels: 12, percent: 50 };
  if (mode === 'percent') return { mode, value: size?.mode === 'percent' ? size.value : fallback.percent };
  if (edge === null) return { mode, value: fallback[mode] };
  const value = mode === 'long' ? edge : mode === 'short' ? edge / ratio : (edge * (edge / ratio)) / 1e6;
  return readSize({ mode, value }) ?? { mode, value: fallback[mode] };
}
