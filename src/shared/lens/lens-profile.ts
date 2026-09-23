/**
 * A lens profile as a PICTURE carries it — `RollPicture.lensProfile`.
 *
 * What is stored is the RESOLVED terms (`LensProfileTerms`, the lens pass's
 * own units, for this picture's focal length and aperture), with the names
 * they came from. Not a reference to the database: the export, a second
 * device and a `.roll.json` then draw the same correction with no fetch and no
 * cache, and a later change to Lensfun never moves a picture already
 * developed — preview = export by construction.
 *
 * **A profile is CALIBRATION, not an edit** — the rule the RAW base follows
 * (`picture-sections.ts`: "the RAW base is material, not an edit"). It is a
 * fact about the glass that took the picture, so it is not copied to another
 * picture by the settings sheet (another lens, another focal length), not
 * cleared by Reset, and not what makes a picture "edited" for the delivery
 * rule; it IS part of the export fingerprint, since it changes the file.
 *
 * **Where it applies.** Lensfun measures the lens on RAW data. A camera's own
 * JPEG — and the render inside a RAW — is often corrected in the body already
 * (Sony's *Distortion Comp.: Auto* is on by default), and correcting it again
 * would bend it the other way. So a profile applies on the SENSOR by itself,
 * and on a render only where the author said so (`onRender`), knowing that.
 *
 * Pure.
 */

import { isIdentityProfile, type LensProfileTerms } from '../render/lens';

export interface LensProfileApplied {
  /** `Sony FE 24-70mm f/4 ZA OSS` — the database's lens, maker and model. */
  lens: string;
  /** `Sony ILCE-7CM2` — the body it was matched through. */
  camera: string;
  /** The picture's own, which the terms were interpolated at. */
  focal: number;
  aperture: number | null;
  terms: LensProfileTerms;
  /** What the database had for this lens: a part it lacked is the identity in `terms`. */
  has: { distortion: boolean; tca: boolean; vignette: boolean };
  /** Applied on a camera RENDER too, by the author's choice — see above. */
  onRender: boolean;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function tuple(v: unknown, n: number, fallback: readonly number[]): number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out = v.map((x, i) => finite(x) ?? fallback[i]);
  return out;
}

/**
 * A stored profile read back — `undefined` when the field is absent (never
 * decided: an automatic lookup may still apply one), `null` when the author
 * took it off (the lookup never puts it back), else the profile, or null for
 * a record too broken to draw.
 */
export function readLensProfile(raw: unknown): LensProfileApplied | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const t = (src.terms ?? {}) as Record<string, unknown>;
  const distortion = tuple(t.distortion, 4, [0, 0, 0, 0]);
  const tcaRed = tuple(t.tcaRed, 3, [1, 0, 0]);
  const tcaBlue = tuple(t.tcaBlue, 3, [1, 0, 0]);
  const vignette = tuple(t.vignette, 3, [0, 0, 0]);
  const focal = finite(src.focal);
  if (!distortion || !tcaRed || !tcaBlue || !vignette || focal === null || typeof src.lens !== 'string') return null;
  const has = (src.has ?? {}) as Record<string, unknown>;
  return {
    lens: src.lens.slice(0, 120),
    camera: typeof src.camera === 'string' ? src.camera.slice(0, 120) : '',
    focal,
    aperture: finite(src.aperture),
    terms: {
      distortion: distortion as LensProfileTerms['distortion'],
      tcaRed: tcaRed as LensProfileTerms['tcaRed'],
      tcaBlue: tcaBlue as LensProfileTerms['tcaBlue'],
      vignette: vignette as LensProfileTerms['vignette'],
    },
    has: { distortion: has.distortion === true, tca: has.tca === true, vignette: has.vignette === true },
    onRender: src.onRender === true,
  };
}

/** The terms a picture's render draws with: its profile where it applies, else none. */
export function profileInEffect(
  profile: LensProfileApplied | null | undefined,
  onSensor: boolean,
): LensProfileTerms | null {
  if (!profile || isIdentityProfile(profile.terms)) return null;
  return onSensor || profile.onRender ? profile.terms : null;
}

/** `distortion · TCA · vignetting` — what a profile corrects, as a line says it. */
export function describeProfileParts(has: LensProfileApplied['has']): string {
  const parts = [has.distortion && 'distortion', has.tca && 'fringing', has.vignette && 'vignetting'].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing measured';
}

/** The key a lookup is cached under: the body and the lens, as the EXIF names them. */
export function lensKey(make: string, model: string, lensModel: string | null | undefined): string {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${squash(make)}|${squash(model)}|${squash(lensModel ?? '')}`;
}
