/**
 * A film's TEXTURE — grain and halation — as a record, and the arithmetic
 * that makes it the same picture at every size.
 *
 * Nothing here draws. The texture is spatial (a neighbour, a noise field)
 * and so it cannot ride the cube every renderer takes; it becomes ONE node
 * of the photo editor's render graph once that exists (`docs/film-simulation.md`
 * §6, `docs/photo-editor.md` P4). What is built ahead of the node is what no
 * graph design can change: the record, its reader, and the two proofs of
 * resolution independence below. Pure and DOM-free.
 *
 * UNITS. Every size is a fraction of the frame's HEIGHT, never pixels: every
 * resampling step in the suite is height-anchored or close (the stage budget
 * scales uniformly, a height-preserving cover crop scales by out.h/src.h, a
 * framing's zoom magnifies grain with the picture as enlarging a negative
 * does), so a grain cell of `f · renderH` pixels lands in the delivered file
 * as `f · outH` pixels whatever the chain. The residual is an aspect-changing
 * crop (3:2 → 16:9, 19 %), under the just-noticeable threshold for grain and
 * with no correct answer — two crops are two enlargements of one negative.
 */

/** The noise tile's side, in texels — one texel is one grain cell. */
export const NOISE_SIZE = 256;

export interface FilmTexture {
  /** 0..1. Grain amount. 0 draws none. */
  grain: number;
  /** A grain cell as a fraction of the frame height. */
  grainSize: number;
  /** 0..1. 0 is fully luma-correlated grain; 1 is independent per channel (digital chroma noise). */
  grainChroma: number;
  /** How often the field re-rolls on a clip, per second of SOURCE time; 0 freezes it (a still, a Ken-Burns move). */
  grainFps: number;
  /** 0..1. Halation amount. 0 runs no blur at all. */
  halation: number;
  /** The bleed's radius as a fraction of the frame height. */
  halationRadius: number;
  /** Linear luminance above which a highlight bleeds. */
  halationThreshold: number;
  /** The bleed's colour, r/g/b in 0..1 — a print's own orange by default. */
  halationTint: readonly [number, number, number];
  /** The noise field's seed. Stored, so a re-export a year later is byte-identical. */
  seed: number;
}

interface Range {
  min: number;
  max: number;
  step: number;
}

export const TEXTURE_RANGES: Readonly<Record<Exclude<keyof FilmTexture, 'halationTint' | 'seed'>, Range>> = {
  grain: { min: 0, max: 1, step: 0.01 },
  grainSize: { min: 0.0004, max: 0.01, step: 0.0001 },
  grainChroma: { min: 0, max: 1, step: 0.01 },
  grainFps: { min: 0, max: 120, step: 1 },
  halation: { min: 0, max: 1, step: 0.01 },
  halationRadius: { min: 0.005, max: 0.2, step: 0.001 },
  halationThreshold: { min: 0, max: 1, step: 0.01 },
};

/** No texture at all — a stock that has none, and what a reader falls back to. */
export const DEFAULT_FILM_TEXTURE: Readonly<FilmTexture> = Object.freeze({
  grain: 0,
  grainSize: 0.0015,
  grainChroma: 0.2,
  grainFps: 24,
  halation: 0,
  halationRadius: 0.04,
  halationThreshold: 0.8,
  halationTint: [1, 0.45, 0.2] as const,
  seed: 1,
});

/** True when nothing would be drawn — the node is skipped entirely. */
export function isSilentTexture(t: FilmTexture | null | undefined): boolean {
  return !t || (t.grain <= 0 && t.halation <= 0);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const clampTo = (v: unknown, r: Range, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(r.max, Math.max(r.min, n));
};

/** A texture read defensively: every number clamped, junk → the default. */
export function normaliseFilmTexture(raw: unknown): FilmTexture {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_FILM_TEXTURE;
  const rawTint = Array.isArray(r.halationTint) && r.halationTint.length === 3 ? r.halationTint : [];
  const channel = (i: number): number => {
    const v: unknown = rawTint[i];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d.halationTint[i];
  };
  const tint: [number, number, number] = [channel(0), channel(1), channel(2)];
  return {
    grain: clampTo(r.grain, TEXTURE_RANGES.grain, d.grain),
    grainSize: clampTo(r.grainSize, TEXTURE_RANGES.grainSize, d.grainSize),
    grainChroma: clampTo(r.grainChroma, TEXTURE_RANGES.grainChroma, d.grainChroma),
    grainFps: clampTo(r.grainFps, TEXTURE_RANGES.grainFps, d.grainFps),
    halation: clampTo(r.halation, TEXTURE_RANGES.halation, d.halation),
    halationRadius: clampTo(r.halationRadius, TEXTURE_RANGES.halationRadius, d.halationRadius),
    halationThreshold: clampTo(r.halationThreshold, TEXTURE_RANGES.halationThreshold, d.halationThreshold),
    halationTint: tint,
    seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? Math.round(r.seed) : d.seed,
  };
}

/**
 * A stored texture, or null where a document holds none — the ONE reader every
 * document goes through (`SavedGrade.film`, `ProjectDoc.lutFilm`,
 * `RollGrade.film`).
 *
 * Junk that is an OBJECT still goes through `normaliseFilmTexture`, which
 * clamps every number: a hand edit or a value from a newer build should land
 * as a sound texture where it can, the way a layer does. Anything else — and
 * a document written before the texture existed — is no texture at all.
 */
export function filmTextureOrNull(raw: unknown): FilmTexture | null {
  return isRecord(raw) ? normaliseFilmTexture(raw) : null;
}

/** A stable identity — what a grade's key and a held grader's key fold in. Canonical order. */
export function filmTextureKey(t: FilmTexture | null | undefined): string {
  if (!t) return '-';
  return [
    t.grain,
    t.grainSize,
    t.grainChroma,
    t.grainFps,
    t.halation,
    t.halationRadius,
    t.halationThreshold,
    t.halationTint.join(','),
    t.seed,
  ].join('|');
}

/** One line for a settled row: `grain 30 % · halation 25 %`, or `No texture`. */
export function describeFilmTexture(t: FilmTexture | null | undefined): string {
  if (isSilentTexture(t)) return 'No texture';
  const parts: string[] = [];
  if (t!.grain > 0) parts.push(`grain ${Math.round(t!.grain * 100)} %`);
  if (t!.halation > 0) parts.push(`halation ${Math.round(t!.halation * 100)} %`);
  return parts.join(' · ');
}

// --- resolution independence -------------------------------------------------

/** A grain cell, in the pixels of a render this tall. */
export function grainCellPixels(t: FilmTexture, renderH: number): number {
  return t.grainSize * renderH;
}

/** Below this many pixels a cell cannot be resolved and the grain fades out rather than aliasing. */
export const MIN_CELL_PX = 1.5;
/** From here up the grain is drawn at full strength. */
export const FADE_CELL_PX = 3;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface GrainUniforms {
  /** (renderW / renderH, 1): the noise UV is the frame's normalised coordinate stretched by this. */
  aspect: readonly [number, number];
  /** Noise texture units per unit of frame HEIGHT: `1 / (grainSize · NOISE_SIZE)`, one texel per cell. */
  scale: number;
  /** 0..1, how much of the grain this render can honestly show. */
  fade: number;
  amount: number;
  chroma: number;
}

/**
 * What the node hands its shader for a render of this size. The UV it
 * implies — `screenUv · aspect · scale + phase` — puts exactly `1 / grainSize`
 * cells down the frame's height at EVERY render size, so the preview samples
 * the same field at the same positions as the export: the same grain pattern,
 * resampled, not merely the same statistics.
 */
export function grainUniforms(t: FilmTexture, renderW: number, renderH: number): GrainUniforms {
  return {
    aspect: [renderW / renderH, 1],
    scale: 1 / (t.grainSize * NOISE_SIZE),
    fade: smoothstep(MIN_CELL_PX, FADE_CELL_PX, grainCellPixels(t, renderH)),
    amount: t.grain,
    chroma: t.grainChroma,
  };
}

/**
 * Whether a preview this tall can show the grain at all — what drives the
 * panel's badge (*finer than this preview can show — it will be there in the
 * export*), a visible state and never a tooltip.
 */
export function grainShowable(t: FilmTexture, previewH: number): { showable: boolean; cellPixels: number } {
  const cellPixels = grainCellPixels(t, previewH);
  return { showable: cellPixels >= MIN_CELL_PX, cellPixels };
}

/** Sigma in texels of the blur buffer — fixes the buffer's height from the radius alone. */
const SIGMA_TEXELS = 4;
const MIN_BUFFER = 64;
const MAX_BUFFER = 512;

export interface HalationBuffer {
  w: number;
  h: number;
  /** The Gaussian's sigma, in texels of this buffer. */
  sigma: number;
}

/**
 * The size of the small buffer the highlights are extracted and blurred in,
 * and the kernel's sigma over it. Both depend on the RADIUS and the aspect
 * only — never on the render size — so a preview and an export blur the same
 * texels with the same sigma over the same buffer: halation is resolution-
 * independent by construction, with no arithmetic left to get wrong. Null
 * when there is no halation to draw.
 */
export function halationBuffer(t: FilmTexture, renderW: number, renderH: number): HalationBuffer | null {
  if (t.halation <= 0) return null;
  const h = Math.min(MAX_BUFFER, Math.max(MIN_BUFFER, Math.round(SIGMA_TEXELS / t.halationRadius)));
  return { w: Math.max(1, Math.round(h * (renderW / renderH))), h, sigma: t.halationRadius * h };
}
