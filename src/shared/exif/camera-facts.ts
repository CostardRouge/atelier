/**
 * What took a photograph, as a set of FACTS a credit can pick from — the body,
 * the lens, the two focal lengths, the exposure triangle, the compensation and
 * a drone's height above take-off — each already written the way the suite
 * prints it (`ƒ/1.7`, `1/240`, `ISO 100`, a typographic minus).
 *
 * `exposureSummary` answers "the whole line"; a camera credit composed à la
 * carte needs the pieces apart, in an order the author chose, and some of them
 * bare under a label (`100` under `ISO`). The formatting is the summary's own,
 * so the legacy line — body, lens, real focal, aperture, shutter, ISO — joined
 * with ` · ` is the very string `exposureSummary` gives, and a badge that never
 * asked for a layout keeps drawing it.
 *
 * A fact the file does not record is ABSENT, never `—` and never guessed: no
 * focal length is derived from a crop factor, no body from a lens. The one
 * deliberate rewrite is the body's display NAME, and only from a table the
 * author wrote (`names`): a DJI still says `FC8482`, not "Mini 4 Pro", and a
 * table of models shipped here would be an invented one.
 *
 * Pure and DOM-free.
 */

import type { ExifData } from './exif-parser';
import { cameraName } from './exif-summary';
import { exifShutter } from './exif-cue';

export type CameraField =
  | 'body'
  | 'lens'
  | 'focal35'
  | 'focal'
  | 'aperture'
  | 'shutter'
  | 'iso'
  | 'ev'
  | 'altitude';

export const CAMERA_FIELDS: readonly {
  id: CameraField;
  label: string;
  /** Names what took it rather than how it was exposed. */
  identity: boolean;
}[] = [
  { id: 'body', label: 'Body', identity: true },
  { id: 'lens', label: 'Lens', identity: true },
  { id: 'focal35', label: 'Focal length, 35 mm eq.', identity: false },
  { id: 'focal', label: 'Focal length, real', identity: false },
  { id: 'aperture', label: 'Aperture', identity: false },
  { id: 'shutter', label: 'Shutter speed', identity: false },
  { id: 'iso', label: 'ISO', identity: false },
  { id: 'ev', label: 'Exposure compensation', identity: false },
  { id: 'altitude', label: 'Height above take-off', identity: false },
];

const FIELD_IDS = new Set<string>(CAMERA_FIELDS.map((f) => f.id));

export function isCameraField(value: unknown): value is CameraField {
  return typeof value === 'string' && FIELD_IDS.has(value);
}

export function isIdentityField(field: CameraField): boolean {
  return field === 'body' || field === 'lens';
}

/**
 * The fields the credit drew before it could be composed, in its order:
 * `exposureSummary`'s line. A piece that never chose keeps exactly this.
 */
export const LEGACY_CAMERA_FIELDS: readonly CameraField[] = [
  'body',
  'lens',
  'focal',
  'aperture',
  'shutter',
  'iso',
];

export interface CameraFact {
  field: CameraField;
  /** As a line says it: `ƒ/1.7`, `ISO 100`, `+0.3 EV`, `24 mm`. */
  value: string;
  /** As it reads under its own label: `100` under ISO, `+0.3` under EV. */
  bare: string;
}

export interface CameraFacts {
  facts: Partial<Record<CameraField, CameraFact>>;
  /**
   * The camera's compensation, ZERO INCLUDED, or null when the file does not
   * say. The `ev` FACT leaves zero out — a camera left on its own reading is
   * the default, not a decision, and a line should not boast of it — but a
   * meter drawn like a viewfinder's reads zero as its centre.
   */
  evStops: number | null;
  /** The body as the file names it, before any renaming — what a name is keyed by. */
  rawBody: string | null;
}

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** `2.8`, not `2.80`; `24`, not `24.0` — `exposureSummary`'s rounding. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** `+0.3`, `−1.0`: a typographic minus, the suite's signed number. */
function signed(n: number): string {
  const abs = Math.round(Math.abs(n) * 10) / 10;
  return `${n < 0 ? '−' : '+'}${abs}`;
}

/**
 * The facts `exif` records. `names` renames a BODY the author has named —
 * keyed by the name the file gives (`cameraName`), matched case-insensitively
 * and ignoring an empty entry — and nothing else.
 */
export function cameraFacts(
  exif: ExifData | null | undefined,
  names?: Readonly<Record<string, string>> | null,
): CameraFacts {
  const facts: Partial<Record<CameraField, CameraFact>> = {};
  const put = (field: CameraField, value: string, bare = value) => {
    facts[field] = { field, value, bare };
  };
  if (!exif) return { facts, evStops: null, rawBody: null };

  const raw = cameraName(exif)?.trim() || null;
  const body = raw ? (renamed(raw, names) ?? raw) : null;
  if (body) put('body', body);

  // A lens that repeats the body is dropped, as the summary drops it: a phone
  // names its lens after itself, and the same words twice are not two facts.
  const lens = exif.lensModel?.trim() || exif.lensMake?.trim();
  if (lens && lens !== raw && lens !== body) put('lens', lens);

  if (finite(exif.focalLength35) && exif.focalLength35 > 0) {
    put('focal35', `${trim(exif.focalLength35)} mm`);
  }
  if (finite(exif.focalLength) && exif.focalLength > 0) put('focal', `${trim(exif.focalLength)} mm`);
  if (finite(exif.fNumber) && exif.fNumber > 0) put('aperture', `ƒ/${trim(exif.fNumber)}`);
  const shutter = exifShutter(exif.exposureTime);
  if (shutter) put('shutter', shutter);
  if (finite(exif.iso) && exif.iso > 0) {
    const iso = String(Math.round(exif.iso));
    put('iso', `ISO ${iso}`, iso);
  }
  const ev = finite(exif.exposureBias) ? exif.exposureBias : null;
  if (ev !== null && Math.round(ev * 10) !== 0) put('ev', `${signed(ev)} EV`, signed(ev));
  if (finite(exif.relativeAltitude)) {
    const m = Math.round(exif.relativeAltitude);
    put('altitude', `${m < 0 ? '−' : ''}${Math.abs(m)} m`);
  }

  return { facts, evStops: ev, rawBody: raw };
}

function renamed(raw: string, names: Readonly<Record<string, string>> | null | undefined): string | null {
  if (!names) return null;
  const want = raw.toLowerCase();
  for (const [key, name] of Object.entries(names)) {
    if (key.trim().toLowerCase() === want && name.trim()) return name.trim();
  }
  return null;
}

/** The facts among `fields` the picture records, in `fields`' order. */
export function pickFacts(facts: CameraFacts, fields: readonly CameraField[]): CameraFact[] {
  const seen = new Set<CameraField>();
  const out: CameraFact[] = [];
  for (const field of fields) {
    if (seen.has(field)) continue;
    seen.add(field);
    const fact = facts.facts[field];
    if (fact) out.push(fact);
  }
  return out;
}

/** The credit as one line, `·`-joined — the legacy fields give `exposureSummary`'s. */
export function factsLine(facts: CameraFacts, fields: readonly CameraField[]): string {
  return pickFacts(facts, fields)
    .map((f) => f.value)
    .join(' · ');
}
