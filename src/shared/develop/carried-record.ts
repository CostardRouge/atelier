/**
 * A carried edit AS STORED (`carried-edit.ts`): its shape and its reader,
 * alone — so a document model can read one back (`media-develop.ts`, read by
 * `project-types.ts`) without the roll model, which reads the project model
 * in turn: going through `roll-types.ts` from here was a cycle that left
 * `ASPECT_PRESETS` undefined at load.
 *
 * Pure and DOM-free.
 */

import { readLensProfile, type LensProfileApplied } from '../lens/lens-profile';
import { keystoneOrNull } from '../render/geometry';
import { lensOrNull } from '../render/lens';
import { detailOrNull } from '../render/detail';
import { postVignetteOrNull } from '../render/post-vignette';
import { readPatches } from '../render/repair';
import { readLayers } from './layer';
import type { PictureEdit, SectionValues } from './roll-types';
import type { SavedMediaRef } from '../projects/media-ref';

/** The sections a host draws as PASSES — the develop and the look ride in its own fields. */
export const CARRIED_SECTIONS = ['perspective', 'lens', 'detail', 'repair', 'layers', 'vignette'] as const satisfies readonly PictureEdit[];

/** One of them. */
export type CarriedSection = (typeof CARRIED_SECTIONS)[number];

/**
 * What a host holds once it took a roll picture's edit: where it came from —
 * always, so the host can say it and offer an update even when the picture
 * carried a develop and a look alone — and the passes, empty then.
 */
export interface CarriedEdit {
  /** Where it came from — what the host says, and what tells it an update is waiting. */
  from: {
    roll: string;
    rollName: string;
    picture: string;
    /** `DJI_0101.JPG`, `DJI_0101.JPG · 2`. */
    label: string;
    /**
     * The file the edit was made on. A host draws the edit only over this
     * file (`carriedOn`): a slide given another picture keeps no perspective,
     * repair or mask that was measured on the first one.
     */
    media: SavedMediaRef;
    /** When it was carried (ms since the epoch). */
    at: number;
  };
  /** The carried sections' values as the roll's picture held them; absent sections are as shot. */
  values: Pick<SectionValues, CarriedSection>;
  /** The lens's measured profile, where the author applied it to the camera's render. */
  lensProfile?: LensProfileApplied | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A stored carried edit read back, or null for anything that is not one. */
export function readCarriedEdit(raw: unknown): CarriedEdit | null {
  if (!isRecord(raw)) return null;
  const from = isRecord(raw.from) ? raw.from : null;
  if (!from || typeof from.roll !== 'string' || typeof from.picture !== 'string' || typeof from.at !== 'number') return null;
  const media = isRecord(from.media) ? from.media : null;
  if (!media || typeof media.name !== 'string' || typeof media.size !== 'number') return null;
  const v = isRecord(raw.values) ? raw.values : {};
  const values: CarriedEdit['values'] = {};
  // Each section through its own reader, as `readSectionValues` reads it.
  if ('perspective' in v) values.perspective = keystoneOrNull(v.perspective);
  if ('lens' in v) values.lens = lensOrNull(v.lens);
  if ('detail' in v) values.detail = detailOrNull(v.detail);
  if ('repair' in v) values.repair = readPatches(v.repair);
  if ('layers' in v) values.layers = readLayers(v.layers);
  if ('vignette' in v) values.vignette = postVignetteOrNull(v.vignette);
  const lensProfile = readLensProfile(raw.lensProfile);
  return {
    from: {
      roll: from.roll,
      rollName: typeof from.rollName === 'string' ? from.rollName : '',
      picture: from.picture,
      label: typeof from.label === 'string' ? from.label : '',
      media: {
        name: media.name,
        size: media.size,
        lastModified: typeof media.lastModified === 'number' ? media.lastModified : 0,
        ...(typeof media.assetId === 'string' ? { assetId: media.assetId } : {}),
        ...(typeof media.hash === 'string' ? { hash: media.hash } : {}),
      },
      at: from.at,
    },
    values,
    ...(lensProfile ? { lensProfile } : {}),
  };
}
