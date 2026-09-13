/**
 * What audio a clip export writes — decided once, before the muxer exists,
 * because the muxer's audio track is fixed the moment it is built.
 *
 * Four outcomes, and the rule each keeps:
 *
 * - `copy` — the clip's own AAC, bit-for-bit. The pipeline's founding rule and
 *   still the DEFAULT whenever a clip has sound of its own: re-encoding
 *   someone's recording is never done behind their back.
 * - `bed`  — audio the suite made (a hook's ticks) becomes the track. Only when
 *   there is no clip sound to preserve: a clip recorded without a microphone
 *   (most drone footage), or a re-timed export, which never carries the
 *   source's sound (a copied track against a re-timed picture is a desync).
 * - `mix`  — the clip's sound decoded, the bed summed into it, re-encoded.
 *   Only when the author ASKED for it, and only at normal speed.
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
  /** The export changes the clip's speed. */
  retimed: boolean;
  /** Something the suite rendered wants to be heard. */
  bed: boolean;
  /** The author asked for the bed to be mixed into the clip's own sound. */
  mix: boolean;
}

export const BED_KEPT_OUT =
  'The clip kept its own sound untouched, so the ticks were left out — turn on mixing to hear both.';

export function planAudio({ sourceAudio, retimed, bed, mix }: AudioPlanInput): AudioPlan {
  const keepsSource = sourceAudio && !retimed;
  if (!bed) return keepsSource ? { kind: 'copy', droppedBed: null } : { kind: 'none' };
  if (!keepsSource) return { kind: 'bed' };
  return mix ? { kind: 'mix' } : { kind: 'copy', droppedBed: BED_KEPT_OUT };
}
