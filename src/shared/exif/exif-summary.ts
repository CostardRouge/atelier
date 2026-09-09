/**
 * A photograph's exposure as one readable line — body, lens, focal length,
 * aperture, shutter, ISO.
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
