/**
 * What a picture IS, for the Develop sheet's chip — and the sentence about
 * what it can give back. An 8-bit picture clips at white; only a RAW keeps
 * what the sensor saw above it, and until the RAW path lands (P6 of
 * `docs/photo-develop.md`) a RAW here is its JPEG twin or nothing.
 *
 * Shared by Trips and the Studio: the second consumer is what moved it out
 * of the piece editor (the `StylePanel` rule).
 */

import { imageTypeLabel } from '../media/image-meta';
import { mediaOrigin } from '../projects/media-identity';
import { WORKING_PREVIEW_EDGE, isWorkingPreview } from './working-preview';

export interface PictureFidelity {
  /** The chip beside the sheet's title, or null with no picture. */
  chip: string | null;
  /** One line under the picture, or null when there is nothing to warn about. */
  note: string | null;
}

export function pictureFidelity(file: File | null): PictureFidelity {
  if (!file) return { chip: null, note: null };
  if (isWorkingPreview(file)) {
    return {
      chip: `working preview · ${WORKING_PREVIEW_EDGE}`,
      note: `its working preview, ${WORKING_PREVIEW_EDGE} px at most — reopen its folder to develop and export the file itself`,
    };
  }
  const origin = mediaOrigin(file);
  if (origin?.fidelity === 'proxy') {
    return {
      chip: 'proxy · 8-bit',
      note: `an 8-bit proxy from ${origin.sourceId}: highlights above white are already gone here`,
    };
  }
  if (!file.type.startsWith('image/')) return { chip: 'clip · 8-bit', note: null };
  return {
    chip: `${imageTypeLabel(file.name)} · 8-bit`,
    note: 'an 8-bit picture: highlights above white are already gone',
  };
}
