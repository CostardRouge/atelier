/**
 * What audio a clip export writes — decided once, before the muxer exists,
 * because the muxer's audio track is fixed the moment it is built.
 *
 * Four outcomes, and the rule each keeps:
 *
 * - `copy` — the clip's own sound. The DEFAULT whenever a clip has sound of
 *   its own. AAC at the clip's own speed is copied bit-for-bit: re-encoding
 *   someone's recording is never done behind their back. Two cases cannot be
 *   copied and are encoded instead, because the alternative is no sound at
 *   all: linear PCM (Sony's XAVC S/HS, `pcm-audio.ts`) and a RE-TIMED clip,
 *   whose sound is stretched to the picture's new length with its pitch kept
 *   (`time-stretch.ts`) — a copied track against a re-timed picture drifts.
 * - `bed`  — audio the suite made (a hook's ticks) becomes the track. Only when
 *   there is no clip sound to keep: a clip recorded without a microphone (most
 *   drone footage).
 * - `mix`  — the clip's sound decoded, the bed summed into it, re-encoded.
 *   Only when the author ASKED for it.
 * - `none` — nothing to write.
 *
 * When a bed exists and does not make it into the file, the plan carries the
 * sentence that says so, so an export never quietly drops what was composed.
 *
 * Pure and DOM-free.
 */

export type AudioPlan =
  | { kind: 'none' }
  | { kind: 'copy'; droppedBed: string | null }
  | { kind: 'bed' }
  | { kind: 'mix' };

export interface AudioPlanInput {
  /** The clip has an audio track of its own. */
  sourceAudio: boolean;
  /** Something the suite rendered wants to be heard. */
  bed: boolean;
  /** The author asked for the bed to be mixed into the clip's own sound. */
  mix: boolean;
}

export const BED_KEPT_OUT =
  'The clip kept its own sound, so the ticks were left out — turn on mixing to hear both.';

export function planAudio({ sourceAudio, bed, mix }: AudioPlanInput): AudioPlan {
  if (!bed) return sourceAudio ? { kind: 'copy', droppedBed: null } : { kind: 'none' };
  if (!sourceAudio) return { kind: 'bed' };
  return mix ? { kind: 'mix' } : { kind: 'copy', droppedBed: BED_KEPT_OUT };
}
