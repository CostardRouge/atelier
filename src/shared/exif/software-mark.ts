/**
 * The mark a file this suite WROTE carries, and how to recognise it.
 *
 * A delivered JPEG copies its original's EXIF block whole (`stamp-exif.ts`),
 * so nothing in its metadata tells it from the camera's own file — and it is
 * named exactly after the picture it came from. Put beside that picture in the
 * folder the originals live in, it looks like the camera's delivered rendition
 * of the same capture, and would be offered as one. The maintainer's own
 * export was found that way, beside his DNG (`docs/capture-renditions.md`
 * §14.6).
 *
 * The one tag every account writes the same way is `Software`, and a reader
 * that finds this value there is looking at something Atelier made — never at
 * a camera's render. A file made elsewhere carries no such mark, and telling
 * one of those from a camera's file is a separate question this module does
 * not answer.
 */

/** What every delivered file says in its `Software` tag. */
export const ATELIER_SOFTWARE = 'Atelier';

/** True when a `Software` value is this suite's mark — a file we wrote. */
export function isAtelierMade(software: string | null | undefined): boolean {
  if (!software) return false;
  return /^Atelier(?![A-Za-z0-9])/.test(software.trim());
}
