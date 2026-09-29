/**
 * WHICH FILE of a media the Studio's stage works from — its source's proxy,
 * or one the capture delivered — as a PROJECT keeps the choice (2026-09-29).
 *
 * The Develop tool has let a picture switch between its capture's files since
 * R3a of `docs/capture-renditions.md`; the Studio opened every Winnow media on
 * its proxy (a 720p H.264 for a clip, a 2048 px WebP for a still) with no way
 * up but the export. This is the same vocabulary (`media/renditions.ts`) for
 * the Studio's two kinds of media: a clip lists its proxy and the rush itself,
 * a still its proxy, the camera's file and the render inside a RAW companion.
 * The SENSOR is not a row here: a stage draws files, and developing a sensor
 * plane is the Develop tool's work (the lightbox's rule, `capture-view.ts`).
 *
 * The choice is stored per media, keyed by base name like the trims and the
 * develops (`ProjectMedia.renditions`), so a project reopened — on another
 * device, through its Winnow copy — shows the same file. It needs no guard of
 * its own: an id names a FILE (`delivered:<name>`), and one the capture no
 * longer offers resolves to nothing and the media opens where it always did.
 *
 * Pure and DOM-free.
 */

import { captureFileType, classifyPart, fileBaseName, isDrawableImage } from '../library/assets';
import { captureInput, type CaptureFacts } from '../develop/capture-files';
import { viewableRenditions } from '../develop/capture-view';
import { openingRendition, renditionById, renditionsOf, type Rendition } from '../media/renditions';

/**
 * What a stage can put on screen by itself: a picture the browser draws, or
 * a clip. A clip's codec is not in its name — an HEVC rush may not decode here
 * — and the stage already says so and offers the transcode when it does not,
 * so the name is enough to LIST it; claiming more would be a guess.
 */
export function canStageDraw(name: string): boolean {
  return isDrawableImage(name) || classifyPart(name) === 'video';
}

/** Every file of one media the stage can switch to, in the pill's order. */
export function stageRenditions(facts: Omit<CaptureFacts, 'canDraw' | 'sensor' | 'siblings'>): Rendition[] {
  return viewableRenditions(renditionsOf(captureInput({ ...facts, sensor: null, canDraw: canStageDraw })));
}

export interface StageChoice {
  /** The row the menu marks — the one chosen, or where the media opens. */
  current: Rendition | null;
  /** The row to bring onto the stage, when it is not where the media opens. */
  wanted: Rendition | null;
}

/**
 * The stored choice read against what the capture offers NOW: a blocked row,
 * a row that is where the media opens anyway, and an id the capture no longer
 * has all come back as "where it opens" — never as an error.
 */
export function stageChoice(rows: readonly Rendition[], stored: string | null | undefined): StageChoice {
  const opening = openingRendition(rows);
  const chosen = renditionById(rows, stored);
  const wanted =
    chosen && chosen.role === 'delivered' && !chosen.blocked && chosen.id !== opening?.id ? chosen : null;
  return { current: wanted ?? opening, wanted };
}

/**
 * The chip's word beside the media's name: `Proxy`, else the file's TYPE when
 * the file is named after the media — `MP4`, `JPEG`, `DNG render` — and its
 * whole name only when it is not. The name is already drawn beside the chip,
 * and a DJI Mini 4 Pro's (`DJI_20260929101500_0001_D.MP4`) said twice pushed
 * the media's own name out of a phone's header. The menu lists whole names.
 */
export function stageChipLabel(row: Rendition, baseName: string): string {
  if (row.role === 'proxy') return 'Proxy';
  if (fileBaseName(row.name).toLowerCase() !== baseName.toLowerCase()) return row.name;
  const type = captureFileType(row.name);
  return row.reach === 'embedded' ? `${type} render` : type;
}

/**
 * The project's choices with `key`'s written — or removed when it is where
 * the media opens (null): one spelling for "chose nothing", as the roll's.
 */
export function writeRendition(
  renditions: Readonly<Record<string, string>>,
  key: string,
  id: string | null,
): Record<string, string> {
  if (id && id !== 'proxy') {
    if (renditions[key] === id) return renditions as Record<string, string>;
    return { ...renditions, [key]: id };
  }
  if (!(key in renditions)) return renditions as Record<string, string>;
  const rest = { ...renditions };
  delete rest[key];
  return rest;
}

/**
 * A stored map as it came off a disk or a wire: only string ids naming a
 * delivered file survive, so a hand edit or a newer build's value never
 * reaches the stage as something to fetch.
 */
export function readRenditions(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.startsWith('delivered:')) out[key] = value;
  }
  return out;
}
