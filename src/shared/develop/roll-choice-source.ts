/**
 * The roll's choice of file (`roll-choice.ts`) read for a picture the stage
 * has NOT shown — what the export and the open picture's *Delivers* row
 * need, from the facts a stage would have gathered, gathered here the same
 * way so the two cannot disagree.
 *
 * Nothing here downloads a capture: the sizes come from the file in hand, a
 * folder sibling's head, and a RAW original's or companion's HEAD (a
 * megabyte, remembered for the session by `delivery-source.ts`). Metering a
 * RAW is a decode, at the stage's own size and held like the stage's, so the
 * gain a follower leaves with is the gain its stage measures.
 */

import { fileIdentity, isRawImage } from '../library/assets';
import { deviceClass } from '../lib/device-class';
import { stageBudget } from '../media/still-decode';
import { renditionsOf, type Rendition } from '../media/renditions';
import type { MediaOrigin } from '../projects/media-identity';
import { canStageDraw } from '../projects/media-rendition';
import { rawDecodeEdge } from '../raw/raw-budget';
import type { ProfileRequest, RawProfile } from '../raw/dng-color';
import { decodeRaw } from '../raw/raw-decoder';
import { maxRenderSize } from '../render/graph-grader';
import { heldOriginal } from '../sources/original-cache';
import { captureInput } from './capture-files';
import { isProxyOverRaw, rawRenderFrom, rawRenderOf } from './delivery-source';
import { measurePicture } from './roll-render';
import { readSiblingFacts } from './use-sibling-facts';

/** Every rendition of the capture behind `file`, as the stage's name menu lists them. */
export async function captureRenditions(
  file: File,
  origin: MediaOrigin | null,
  siblings: readonly File[],
  assetId: string | null,
): Promise<Rendition[]> {
  const measured = await measurePicture(file);
  const original = origin && isProxyOverRaw(origin) ? (await rawRenderOf(origin, assetId)).render : undefined;
  const companion = origin?.companion ?? null;
  const companionRender =
    companion && isRawImage(companion.name) ? (await rawRenderFrom(companion.fetchHead, companion.assetId)).render : undefined;
  const facts = siblings.length ? await readSiblingFacts(siblings) : new Map();
  return renditionsOf(
    captureInput({
      file,
      origin,
      measured,
      sensor: null,
      original: { assetId, held: assetId ? heldOriginal(assetId) !== null : false, render: original },
      companion: companion ? { held: heldOriginal(companion.assetId) !== null, render: companionRender } : undefined,
      siblings: siblings.flatMap((s) => {
        const known = facts.get(fileIdentity(s));
        return known ? [{ file: s, facts: known }] : [];
      }),
      canDraw: canStageDraw,
    }),
  );
}

/**
 * The exposure a RAW is metered at, measured the way the stage measures it —
 * the same budget, the same edge, held for the session — so a picture the
 * roll put on its sensor leaves with the gain its stage would show.
 */
export async function meterRawGain(file: File, signal?: AbortSignal): Promise<number> {
  return (await meterRaw(file, signal)).gain;
}

/**
 * The gain AND the camera profile (`dng-color.ts`) of a RAW, from the one
 * decode the stage would make — what a picture on the roll's sensor leaves
 * with, as its stage shows it.
 */
export async function meterRaw(
  file: File,
  signal?: AbortSignal,
  profile: ProfileRequest = null,
): Promise<{ gain: number; profile: RawProfile | null }> {
  const decoded = await decodeRaw(file, {
    profile,
    budgetPixels: stageBudget(),
    maxEdge: rawDecodeEdge('stage', deviceClass(), maxRenderSize()),
    signal,
    quiet: true,
    withBytes: false,
    hold: true,
  });
  return { gain: decoded.gain, profile: decoded.profile };
}
