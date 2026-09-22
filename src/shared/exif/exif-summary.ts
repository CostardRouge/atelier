/**
 * A photograph's exposure as one readable line — body, lens, focal length,
 * aperture, shutter, ISO — and, for a stage where the body is already named,
 * the four facts a photographer reads at speed (`captureLine`).
 *
 * The lightbox's second fact line, and pure so both sources feed it: a file's
 * own EXIF read off disk, and the columns an instance parsed at ingest. Every
 * field is optional and a missing one is simply absent — the line never says
 * `—` and never guesses, exactly like the elements that draw these values.
 *
 * DOM-free.
 */

import type { ExifData } from './exif-parser';
import { exifShutter } from './exif-cue';

function finite(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** `2.8`, not `2.80`; `24`, not `24.0`. */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** A model that already carries its maker's name does not want it twice. */
export function cameraName(exif: ExifData): string | undefined {
  const model = exif.model?.trim();
  const make = exif.make?.trim();
  if (!model) return make || undefined;
  if (!make) return model;
  return model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`;
}

/**
 * The exposure line, `·`-joined, or `''` when the picture says nothing.
 *
 * `body` overrides the camera name — a source that keeps its own display
 * label (Winnow's `camera_model`) passes it rather than having it inferred.
 * A lens whose name repeats the body is dropped: `DJI Mini 4 Pro` twice on
 * one line is noise, not a second fact.
 */
export function exposureSummary(
  exif: ExifData | null | undefined,
  body?: string | null,
): string {
  if (!exif) return body?.trim() ?? '';
  const parts: string[] = [];
  const camera = body?.trim() || cameraName(exif);
  if (camera) parts.push(camera);

  const lens = exif.lensModel?.trim() || exif.lensMake?.trim();
  if (lens && lens !== camera) parts.push(lens);

  if (finite(exif.focalLength) && exif.focalLength > 0) {
    parts.push(`${trim(exif.focalLength)} mm`);
  }
  if (finite(exif.fNumber) && exif.fNumber > 0) parts.push(`ƒ/${trim(exif.fNumber)}`);
  const shutter = exifShutter(exif.exposureTime);
  if (shutter) parts.push(shutter);
  if (finite(exif.iso) && exif.iso > 0) parts.push(`ISO ${Math.round(exif.iso)}`);

  return parts.join(' · ');
}

/**
 * `+0.3`, `−1.0` — a typographic minus, the way the suite prints a signed
 * number (`develop.ts`'s `signed`, which lives a layer away: `shared/exif`
 * knows nothing about a develop and is not about to learn).
 */
function evText(n: number): string {
  const abs = Math.round(Math.abs(n) * 10) / 10;
  return `${n < 0 ? '−' : '+'}${abs}`;
}

/**
 * The four facts a photographer reads at speed, `·`-joined:
 * `ƒ/1.7 · 1/240 · ISO 100 · +0.3 EV`.
 *
 * `exposureSummary`'s shorter twin, for a surface that already names the file
 * — the Develop stage, where the body and the lens are one glance away in the
 * bar and the line is drawn OVER the photograph, so every character costs a
 * pixel of it. The compensation is the one fact the long line never carried:
 * it is what says the camera was argued with before this session started.
 *
 * Absent fields are absent, never `—`, and a compensation of zero says
 * nothing — a camera left on its own reading is the default, not a decision.
 * A picture that says nothing at all yields `''`.
 */
export function captureLine(exif: ExifData | null | undefined): string {
  if (!exif) return '';
  const parts: string[] = [];
  if (finite(exif.fNumber) && exif.fNumber > 0) parts.push(`ƒ/${trim(exif.fNumber)}`);
  const shutter = exifShutter(exif.exposureTime);
  if (shutter) parts.push(shutter);
  if (finite(exif.iso) && exif.iso > 0) parts.push(`ISO ${Math.round(exif.iso)}`);
  if (finite(exif.exposureBias) && Math.round(exif.exposureBias * 10) !== 0) {
    parts.push(`${evText(exif.exposureBias)} EV`);
  }
  return parts.join(' · ');
}
