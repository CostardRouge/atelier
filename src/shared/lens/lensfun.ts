import type { LensProfileTerms } from '../render/lens';

/**
 * LENSFUN — measured lens profiles (audit item 20, his YES of 2026-09-23:
 * *fetched on demand per lens, kept locally, never the whole database in
 * `dist/`*). This module is the pure half: it READS a Lensfun database file,
 * FINDS the camera and the lens a picture's EXIF names, INTERPOLATES the
 * calibration at the picture's focal length and aperture exactly as
 * `libs/lensfun/lens.cpp` does, and CONVERTS it to the units `render/lens.ts`
 * works in. The fetching and the cache are `lensfun-fetch.ts`.
 *
 * Why this clears the bar P6 set (no invented coefficients): a Lensfun
 * profile is MEASURED — someone photographed a target with that lens on a
 * body of known crop factor — so applying it is applying data, not guessing.
 *
 * **Three coordinate systems, and the conversion is the whole trap.** Lensfun's
 * distortion and TCA models (`ptlens`, `poly3`, `poly5`, `linear`) are the
 * Hugin ones: r = 1 at HALF THE SHORT SIDE of the CALIBRATION sensor. Its
 * vignetting model (`pa`) has r = 1 at the calibration sensor's CORNER. This
 * suite's lens pass has r = 1 at the corner of the picture being corrected
 * (`lens.ts`, half the diagonal). With a sensor's half-diagonal in millimetres
 * `D = hypot(36, 24) / crop / 2`, one of our units is
 *
 *     s = hypot(calAspect, 1) · calCrop / imageCrop   Hugin units
 *     q = calCrop / imageCrop                          `pa` units
 *
 * The real focal length cancels out of that conversion (Lensfun multiplies by
 * it on the way into its internal units and divides on the way back), so it
 * is read and not needed.
 *
 * What is refused rather than approximated: a fisheye or any non-rectilinear
 * lens (its correction is a change of projection, not a radius polynomial),
 * the `acm` models, and a calibration made on a SMALLER sensor than the
 * picture's (Lensfun's own rule: `imageCrop / calCrop ≥ 0.96`) — its
 * coefficients say nothing about the corners it never saw.
 *
 * Pure and DOM-free: the XML is read with a few regular expressions over the
 * database's own simple, attribute-only shape, so a spec runs in node.
 */

export interface LensfunCamera {
  maker: string;
  /** Every name the model goes by — the EXIF one and its `lang` variants. */
  models: string[];
  mount: string;
  crop: number;
}

export type DistortionModel = 'ptlens' | 'poly3' | 'poly5';
export type TcaModel = 'linear' | 'poly3';

export interface DistortionEntry {
  model: DistortionModel;
  focal: number;
  /** ptlens [a, b, c], poly3 [k1], poly5 [k1, k2]. */
  terms: number[];
}

export interface TcaEntry {
  model: TcaModel;
  focal: number;
  /** Lensfun's own order: linear [kr, kb]; poly3 [vr, vb, cr, cb, br, bb]. */
  terms: number[];
}

export interface VignettingEntry {
  focal: number;
  aperture: number;
  distance: number;
  /** `pa`: [k1, k2, k3]. */
  terms: [number, number, number];
}

export interface LensfunLens {
  maker: string;
  models: string[];
  mounts: string[];
  /** The crop factor of the sensor the calibration was MADE on. */
  crop: number;
  /** Its aspect ratio, long over short — 3:2 unless said. */
  aspect: number;
  /** `rectilinear` unless the database says otherwise. */
  type: string;
  focalMin: number | null;
  focalMax: number | null;
  distortion: DistortionEntry[];
  tca: TcaEntry[];
  vignetting: VignettingEntry[];
}

export interface LensfunDb {
  cameras: LensfunCamera[];
  lenses: LensfunLens[];
}

// --- reading ------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function text(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e]).trim();
}

/** Every value of `<tag …>value</tag>` in a block, the untagged (`lang`-less) one first. */
function values(block: string, tag: string): string[] {
  const plain: string[] = [];
  const lang: string[] = [];
  const re = new RegExp(`<${tag}(\\s+lang="[^"]*")?\\s*>([^<]*)</${tag}>`, 'g');
  for (let m = re.exec(block); m; m = re.exec(block)) (m[1] ? lang : plain).push(text(m[2]));
  return [...plain, ...lang];
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  for (let m = re.exec(s); m; m = re.exec(s)) out[m[1]] = m[2];
  return out;
}

function num(v: string | undefined, fallback = NaN): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** `3:2` → 1.5, `1.778` → 1.778; always long over short. */
function aspectOf(v: string | undefined): number {
  if (!v) return 1.5;
  const m = /^\s*([\d.]+)\s*:\s*([\d.]+)\s*$/.exec(v);
  const a = m ? Number(m[1]) / Number(m[2]) : Number(v);
  return Number.isFinite(a) && a > 0 ? Math.max(a, 1 / a) : 1.5;
}

/**
 * One database file read. Comments go first: the files hold commented-out
 * entries (an older calibration kept for reference), which a reader that
 * skipped this step would apply.
 */
export function parseLensfunXml(xml: string): LensfunDb {
  const src = xml.replace(/<!--[\s\S]*?-->/g, '');
  const cameras: LensfunCamera[] = [];
  const lenses: LensfunLens[] = [];
  for (const m of src.matchAll(/<camera>([\s\S]*?)<\/camera>/g)) {
    const b = m[1];
    const maker = values(b, 'maker')[0];
    const models = values(b, 'model');
    const mount = values(b, 'mount')[0];
    const crop = num(values(b, 'cropfactor')[0]);
    if (maker && models.length && mount && crop > 0) cameras.push({ maker, models, mount, crop });
  }
  for (const m of src.matchAll(/<lens>([\s\S]*?)<\/lens>/g)) {
    const b = m[1];
    const maker = values(b, 'maker')[0] ?? '';
    const models = values(b, 'model');
    if (!models.length) continue;
    const focal = /<focal\s+([^>]*?)\/?>/.exec(b);
    const f = focal ? attrs(focal[1]) : {};
    const lens: LensfunLens = {
      maker,
      models,
      mounts: values(b, 'mount'),
      crop: num(values(b, 'cropfactor')[0], 1),
      aspect: aspectOf(values(b, 'aspect-ratio')[0]),
      type: values(b, 'type')[0] ?? 'rectilinear',
      focalMin: Number.isFinite(num(f.min ?? f.value)) ? num(f.min ?? f.value) : null,
      focalMax: Number.isFinite(num(f.max ?? f.value)) ? num(f.max ?? f.value) : null,
      distortion: [],
      tca: [],
      vignetting: [],
    };
    for (const e of b.matchAll(/<(distortion|tca|vignetting)\s+([^>]*?)\/?>/g)) {
      const a = attrs(e[2]);
      const at = num(a.focal);
      if (!(at > 0)) continue;
      if (e[1] === 'distortion') {
        if (a.model === 'ptlens') lens.distortion.push({ model: 'ptlens', focal: at, terms: [num(a.a, 0), num(a.b, 0), num(a.c, 0)] });
        else if (a.model === 'poly3') lens.distortion.push({ model: 'poly3', focal: at, terms: [num(a.k1, 0)] });
        else if (a.model === 'poly5') lens.distortion.push({ model: 'poly5', focal: at, terms: [num(a.k1, 0), num(a.k2, 0)] });
      } else if (e[1] === 'tca') {
        if (a.model === 'linear') lens.tca.push({ model: 'linear', focal: at, terms: [num(a.kr, 1), num(a.kb, 1)] });
        else if (a.model === 'poly3')
          lens.tca.push({
            model: 'poly3',
            focal: at,
            terms: [num(a.vr, 1), num(a.vb, 1), num(a.cr, 0), num(a.cb, 0), num(a.br, 0), num(a.bb, 0)],
          });
      } else if (a.model === 'pa') {
        lens.vignetting.push({
          focal: at,
          aperture: num(a.aperture, NaN),
          distance: num(a.distance, 1000),
          terms: [num(a.k1, 0), num(a.k2, 0), num(a.k3, 0)],
        });
      }
    }
    lens.vignetting = lens.vignetting.filter((v) => v.aperture > 0);
    lenses.push(lens);
  }
  return { cameras, lenses };
}

// --- finding ------------------------------------------------------------------

/** Lower case, letters and digits only — how a maker or a model is compared. */
export function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** EXIF makers that are not spelled as Lensfun spells them. */
const MAKER_ALIASES: Record<string, string> = {
  nikoncorporation: 'nikon',
  olympusimagingcorp: 'olympus',
  olympuscorporation: 'olympus',
  omdigitalsolutions: 'omdigitalsolutions',
  ricohimaging: 'ricoh',
  pentaxcorporation: 'pentax',
  eastmankodakcompany: 'kodak',
  fujiphotofilmcoltd: 'fujifilm',
  samsungtechwin: 'samsung',
  leicacameraag: 'leica',
};

export function makerKey(make: string): string {
  const k = squash(make);
  return MAKER_ALIASES[k] ?? k;
}

/**
 * The camera an EXIF `Make` + `Model` name. Lensfun spells the model the way
 * the camera writes it (`ILCE-7CM2`), so the comparison is exact once squashed
 * — with the maker's name taken off the model where the body repeats it
 * (`Canon EOS R5`).
 */
export function findCamera(dbs: readonly LensfunDb[], make: string, model: string): LensfunCamera | null {
  const maker = makerKey(make);
  const m = squash(model);
  const bare = m.startsWith(maker) ? m.slice(maker.length) : m;
  for (const db of dbs)
    for (const c of db.cameras) {
      if (makerKey(c.maker) !== maker) continue;
      if (c.models.some((x) => squash(x) === m || squash(x) === bare)) return c;
    }
  return null;
}

/**
 * A lens name as words: runs of letters and runs of numbers apart, so
 * `FE 24-70mm F2.8 GM II` and Lensfun's `FE 24-70mm f/2.8 GM II` read alike.
 */
export function lensWords(name: string): string[] {
  return name.toLowerCase().replace(/f\//g, 'f').match(/[0-9]+(?:\.[0-9]+)?|[a-z]+/g) ?? [];
}

/**
 * How well two lens names agree, 0..1: shared words over all words (so `GM`
 * and `GM II` are told apart), and 0 outright when their NUMBERS differ — a
 * 24-70 is never a 24-105, however many words the two share.
 */
export function lensNameScore(a: string, b: string): number {
  const x = lensWords(a);
  const y = lensWords(b);
  if (!x.length || !y.length) return 0;
  const nx = x.filter((w) => /^\d/.test(w)).sort().join(',');
  const ny = y.filter((w) => /^\d/.test(w)).sort().join(',');
  if (nx !== ny) return 0;
  const X = new Set(x);
  const Y = new Set(y);
  let both = 0;
  for (const w of X) if (Y.has(w)) both += 1;
  return both / new Set([...x, ...y]).size;
}

/** Below this, two names are not the same lens. */
export const LENS_MATCH_FLOOR = 0.6;

export interface LensMatch {
  lens: LensfunLens;
  score: number;
}

/**
 * The lens a picture was taken with, among the database's, for this camera:
 * on its mount (or, for a fixed-lens camera, its own), calibrated on a sensor
 * no smaller than the picture's (`imageCrop / lens.crop ≥ 0.96`, the closest
 * such), rectilinear, with a name that agrees with the EXIF `LensModel`. A
 * fixed-lens camera needs no name: its mount holds one lens.
 */
export function findLens(dbs: readonly LensfunDb[], camera: LensfunCamera, lensModel: string | null | undefined): LensMatch | null {
  const candidates: LensMatch[] = [];
  for (const db of dbs)
    for (const lens of db.lenses) {
      if (!lens.mounts.includes(camera.mount)) continue;
      if (lens.type !== 'rectilinear') continue;
      if (camera.crop / lens.crop < 0.96) continue;
      const score = lensModel ? Math.max(...lens.models.map((m) => lensNameScore(lensModel, m))) : 1;
      if (score >= LENS_MATCH_FLOOR || (!lensModel && lens.mounts.length === 1)) candidates.push({ lens, score });
    }
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      // The calibration made on the sensor closest to the picture's, from above.
      camera.crop / a.lens.crop - camera.crop / b.lens.crop,
  );
  return candidates[0];
}

// --- interpolating, as lens.cpp does ------------------------------------------

/** Lensfun's `_lf_interpolate`: a Hermite spline through y2 → y3, its tangents from the outer two when they exist. */
export function hermite(y1: number | null, y2: number, y3: number, y4: number | null, t: number): number {
  const tg2 = y1 === null ? y3 - y2 : (y3 - y1) * 0.5;
  const tg3 = y4 === null ? y3 - y2 : (y4 - y2) * 0.5;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y2 + (t3 - 2 * t2 + t) * tg2 + (-2 * t3 + 3 * t2) * y3 + (t3 - t2) * tg3;
}

/**
 * The entries of one model at `focal`: an exact focal as it is, else the
 * Hermite spline over the two nearest below and the two above, else the
 * nearest one alone. `scaled(i)` says whether term i is interpolated as
 * `term × focal` — Lensfun's `__parameter_scales`, which does that for every
 * distortion term and for the TCA's radius terms.
 */
function interpolate<T extends { focal: number; terms: number[] }>(
  entries: readonly T[],
  focal: number,
  scaled: (i: number) => boolean,
): { model: T; terms: number[] } | null {
  if (!entries.length) return null;
  const first = entries[0] as T & { model?: string };
  const same = entries.filter((e) => (e as T & { model?: string }).model === first.model);
  const exact = same.find((e) => e.focal === focal);
  if (exact) return { model: exact, terms: [...exact.terms] };
  const below = same.filter((e) => e.focal < focal).sort((a, b) => b.focal - a.focal);
  const above = same.filter((e) => e.focal > focal).sort((a, b) => a.focal - b.focal);
  if (!below.length || !above.length) {
    const only = below[0] ?? above[0];
    return { model: only, terms: [...only.terms] };
  }
  const [p1, p0] = [below[0], below[1] ?? null];
  const [p2, p3] = [above[0], above[1] ?? null];
  const t = (focal - p1.focal) / (p2.focal - p1.focal);
  const terms = p1.terms.map((_, i) => {
    const w = (e: T) => (scaled(i) ? e.focal : 1);
    return (
      hermite(
        p0 ? p0.terms[i] * w(p0) : null,
        p1.terms[i] * w(p1),
        p2.terms[i] * w(p2),
        p3 ? p3.terms[i] * w(p3) : null,
        t,
      ) / (scaled(i) ? focal : 1)
    );
  });
  return { model: p1, terms };
}

export function interpolateDistortion(lens: LensfunLens, focal: number): DistortionEntry | null {
  const r = interpolate(lens.distortion, focal, () => true);
  return r ? { model: r.model.model, focal, terms: r.terms } : null;
}

export function interpolateTca(lens: LensfunLens, focal: number): TcaEntry | null {
  const r = interpolate(lens.tca, focal, (i) => i >= 2);
  return r ? { model: r.model.model, focal, terms: r.terms } : null;
}

/**
 * The vignetting at a focal length, an aperture and a distance: Lensfun's
 * inverse-distance weighting (power 3.5) over every entry, in a space where
 * the focal range, `4 / aperture` and `0.1 / distance` each span about one —
 * and nothing when the nearest entry is further than 1 away, which is
 * Lensfun's own refusal to extrapolate.
 */
export function interpolateVignetting(
  lens: LensfunLens,
  focal: number,
  aperture: number,
  distance = 1000,
): [number, number, number] | null {
  const entries = lens.vignetting;
  if (!entries.length || !(aperture > 0)) return null;
  const fMin = lens.focalMin ?? Math.min(...entries.map((e) => e.focal));
  const fMax = lens.focalMax ?? Math.max(...entries.map((e) => e.focal));
  const span = fMax - fMin;
  const norm = (f: number) => (span ? (f - fMin) / span : f - fMin);
  let total = 0;
  const acc = [0, 0, 0];
  let nearest = Infinity;
  for (const e of entries) {
    const d = Math.hypot(norm(e.focal) - norm(focal), 4 / e.aperture - 4 / aperture, 0.1 / e.distance - 0.1 / distance);
    if (d < 0.0001) return [...e.terms];
    nearest = Math.min(nearest, d);
    const w = Math.abs(1 / d ** 3.5);
    for (let i = 0; i < 3; i += 1) acc[i] += w * e.terms[i];
    total += w;
  }
  if (nearest > 1 || !(total > 0)) return null;
  return [acc[0] / total, acc[1] / total, acc[2] / total];
}

// --- into this suite's units ---------------------------------------------------

/* A measured profile in the units `render/lens.ts` draws in — `LensProfileTerms` there. */
export type { LensProfileTerms } from '../render/lens';

/**
 * The three corrections of `lens` at this focal length and aperture, for a
 * picture taken on a sensor of `imageCrop` — each null where the database has
 * no data for it (a lens with distortion and no vignetting is common), in
 * which case that part of the terms is the identity.
 */
export function profileTerms(
  lens: LensfunLens,
  shot: { focal: number; aperture: number | null; imageCrop: number; distance?: number },
): { terms: LensProfileTerms; has: { distortion: boolean; tca: boolean; vignette: boolean } } {
  const s = Math.hypot(lens.aspect, 1) * (lens.crop / shot.imageCrop);
  const q = lens.crop / shot.imageCrop;
  const terms: LensProfileTerms = {
    distortion: [0, 0, 0, 0],
    tcaRed: [1, 0, 0],
    tcaBlue: [1, 0, 0],
    vignette: [0, 0, 0],
  };
  const dist = interpolateDistortion(lens, shot.focal);
  if (dist) {
    if (dist.model === 'ptlens') {
      // Lensfun's centre-preserving rescale (mod-coord.cpp): a' = a/d⁴,
      // b' = b/d³, c' = c/d², so the middle of the picture keeps its scale.
      const [a, b, c] = dist.terms;
      const d = 1 - a - b - c;
      terms.distortion = [(c / d ** 2) * s, (b / d ** 3) * s ** 2, (a / d ** 4) * s ** 3, 0];
    } else if (dist.model === 'poly3') {
      const [k1] = dist.terms;
      terms.distortion = [0, (k1 / (1 - k1) ** 3) * s ** 2, 0, 0];
    } else {
      const [k1, k2] = dist.terms;
      terms.distortion = [0, k1 * s ** 2, 0, k2 * s ** 4];
    }
  }
  const tca = interpolateTca(lens, shot.focal);
  if (tca) {
    if (tca.model === 'linear') {
      terms.tcaRed = [tca.terms[0], 0, 0];
      terms.tcaBlue = [tca.terms[1], 0, 0];
    } else {
      const [vr, vb, cr, cb, br, bb] = tca.terms;
      terms.tcaRed = [vr, cr * s, br * s ** 2];
      terms.tcaBlue = [vb, cb * s, bb * s ** 2];
    }
  }
  const vig = shot.aperture ? interpolateVignetting(lens, shot.focal, shot.aperture, shot.distance) : null;
  if (vig) terms.vignette = [vig[0] * q ** 2, vig[1] * q ** 4, vig[2] * q ** 6];
  return { terms, has: { distortion: Boolean(dist), tca: Boolean(tca), vignette: Boolean(vig) } };
}
