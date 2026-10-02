/**
 * The Crop tab's automatic verbs as SWITCHES — Auto level and Crop to subject,
 * the same rule as the Adjust tab's Auto row (`auto-slots.ts`): a press
 * writes, a second press puts back the crop that was there before it.
 *
 * Both write the ONE stored crop (the aspect and the framing), so they are
 * not disjoint the way the develop's slots are — and the order they are used
 * in is the reason a memo is kept PER VERB rather than one for the frame:
 * level, then crop to the subject (which keeps the levelled angle), then
 * turning the crop off gives back the LEVELLED picture, and Auto level lights
 * again. One shared slot inheriting its `before`, as Auto colour and Pick
 * grey do, threw the level away with the crop. Pure.
 */
import { switchState, type AutoState, type SwitchMemo } from '../../shared/develop/auto-slots';
import { sameFraming, type Framing } from '../../shared/media/framing';

export type CropVerb = 'level' | 'subject';

/** The crop as the roll stores it. */
export interface StoredCrop {
  aspect: string;
  framing: Framing;
}

export interface CropSwitch extends SwitchMemo<StoredCrop> {
  verb: CropVerb;
}

/** One memo per verb. */
export type CropSwitches = Partial<Record<CropVerb, CropSwitch>>;

export function sameStoredCrop(a: StoredCrop, b: StoredCrop): boolean {
  return a.aspect === b.aspect && sameFraming(a.framing, b.framing);
}

/** What a verb's switch shows over the crop on screen. */
export function cropSwitchState(memos: CropSwitches, verb: CropVerb, now: StoredCrop): AutoState {
  const held = memos[verb];
  return held ? switchState(held, now, sameStoredCrop) : 'off';
}

/** The memos after `verb` moved the crop from `now` to `after`. */
export function recordCropSwitch(memos: CropSwitches, verb: CropVerb, now: StoredCrop, after: StoredCrop): CropSwitches {
  return { ...memos, [verb]: { verb, before: now, after } };
}

/**
 * Turning a verb's switch off: the crop to put back, or null when there is
 * none (off already, or a press that changed nothing — whose memo is dropped).
 * A memo that restored is KEPT, marked off, so an undo of the turn-off lights
 * the switch again.
 */
export function revertCropSwitch(
  memos: CropSwitches,
  verb: CropVerb,
  now: StoredCrop,
): { memos: CropSwitches; restore: StoredCrop | null; state: AutoState } {
  const held = memos[verb];
  const state = cropSwitchState(memos, verb, now);
  if (!held || state === 'off') return { memos, restore: null, state };
  if (state === 'nothing') {
    const rest = { ...memos };
    delete rest[verb];
    return { memos: rest, restore: null, state };
  }
  return { memos: { ...memos, [verb]: { ...held, off: true } }, restore: held.before, state };
}
