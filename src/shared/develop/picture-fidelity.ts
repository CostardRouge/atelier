/**
 * What a picture IS, for the Develop sheet's chip — and the sentence about
 * what it can give back. An 8-bit picture clips at white; only a RAW keeps
 * what the sensor saw above it, and until the RAW path lands (P10 of
 * `docs/photo-editor.md`) a RAW here is the render its camera wrote inside it.
 *
 * Shared by Trips and the Studio: the second consumer is what moved it out
 * of the piece editor (the `StylePanel` rule).
 */

import { isRawImage } from '../library/assets';
import { imageTypeLabel } from '../media/image-meta';
import { mediaOrigin } from '../projects/media-identity';
import { WORKING_PREVIEW_EDGE, isWorkingPreview } from './working-preview';

export interface PictureFidelity {
  /** The chip beside the sheet's title, or null with no picture. */
  chip: string | null;
  /** One line under the picture, or null when there is nothing to warn about. */
  note: string | null;
}

/**
 * `base` is the material the develop acts on: on `raw` the picture on screen
 * is the SENSOR's data decoded to linear light (`shared/raw/`), whatever the
 * file in hand is — a local DNG, or a proxy whose RAW original was fetched.
 */
export function pictureFidelity(file: File | null, base: 'render' | 'raw' | null | undefined = null): PictureFidelity {
  if (!file) return { chip: null, note: null };
  if (base === 'raw') {
    return {
      chip: 'RAW · 16-bit linear',
      note: 'the sensor’s own data, decoded to linear light: what it kept above the displayed white is here to bring back',
    };
  }
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
  // BEFORE the media-type test: a RAW off a disk usually carries an empty
  // type, so asking the type first called every DNG a clip. It is on screen at
  // all only through the render its camera wrote inside it
  // (`shared/exif/raw-probe.ts`), and "8-bit" alone would let that pass for
  // the file's own pixels.
  if (isRawImage(file.name)) {
    return {
      chip: `${imageTypeLabel(file.name)} · camera render`,
      note: 'the JPEG your camera wrote inside the RAW, not the sensor data — 8-bit, so highlights above white are already gone from it',
    };
  }
  if (!file.type.startsWith('image/')) return { chip: 'clip · 8-bit', note: null };
  return {
    chip: `${imageTypeLabel(file.name)} · 8-bit`,
    note: 'an 8-bit picture: highlights above white are already gone',
  };
}
