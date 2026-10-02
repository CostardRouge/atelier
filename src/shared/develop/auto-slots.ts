/**
 * The Auto verbs as SWITCHES — each one turned off on its own (2026-10-02,
 * the maintainer: «pouvoir les avoir de manière indépendante, y revenir en
 * arrière individuellement»).
 *
 * What makes it cheap: every verb writes its OWN fields and no field is
 * written by two verbs, except the white balance Auto colour and Pick grey
 * share. So a verb's whole effect is two small records — its fields before
 * the click and after it — and taking it back is putting `before` on those
 * fields alone, never touching another verb's.
 *
 * The state is READ from the develop, never stored beside it: a switch is on
 * while its fields still hold what it wrote, off once they hold what was
 * there before (or once it was turned off), edited when anything else moved
 * them. That is what lets an
 * undo turn the switches on and off by itself without the history knowing
 * they exist. Pure; the memory of one session lives in `use-auto-memory.ts`.
 */
import { cloneLevels, sameLevels } from './curves';
import type { DevelopSettings } from './develop';

/** The verbs of the Auto row that write the develop. */
export type AutoVerb = 'tone' | 'colour' | 'pick' | 'bands';

/** A group of fields one verb owns. Pick grey and Auto colour share `balance`. */
export type AutoSlot = 'tone' | 'balance' | 'bands';

export const AUTO_SLOT: Readonly<Record<AutoVerb, AutoSlot>> = {
  tone: 'tone',
  colour: 'balance',
  pick: 'balance',
  bands: 'bands',
};

/** The fields each slot owns — the whole of what its verb writes. */
export const SLOT_FIELDS = {
  tone: ['levels'],
  balance: ['temperature', 'tint'],
  bands: ['shadows', 'highlights'],
} as const satisfies Readonly<Record<AutoSlot, readonly (keyof DevelopSettings)[]>>;

/** A slot's fields, as a verb wrote them or as they were before it. */
export type SlotValues = Partial<Pick<DevelopSettings, 'levels' | 'temperature' | 'tint' | 'shadows' | 'highlights'>>;

/** One click: which verb, and its slot's fields before and after it. */
export interface AutoMemo {
  verb: AutoVerb;
  before: SlotValues;
  after: SlotValues;
  /**
   * Set when the switch was turned off. From then on a hand moving the fields
   * is not an edit of the verb's answer, so the switch stays off — unless the
   * fields come back to `after` exactly, which is an undo of the turn-off.
   */
  off?: boolean;
}

/** At most one memo per slot: a newer verb of the slot replaces the older. */
export type AutoMemos = Partial<Record<AutoSlot, AutoMemo>>;

/**
 * - `off`: never pressed, turned off, or undone back to `before`
 * - `on`: the fields still hold what the verb wrote
 * - `nothing`: the verb wrote what was already there
 * - `edited`: a hand (or the slot's other verb) moved the fields since
 */
export type AutoState = 'off' | 'on' | 'nothing' | 'edited';

/** A slot's fields read off a develop — levels copied, so a memo never aliases the draft. */
export function slotValues(develop: DevelopSettings, slot: AutoSlot): SlotValues {
  if (slot === 'tone') return { levels: cloneLevels(develop.levels) };
  if (slot === 'balance') return { temperature: develop.temperature, tint: develop.tint };
  return { shadows: develop.shadows, highlights: develop.highlights };
}

/** Whether two records of a slot say the same thing. Absent levels and neutral levels are one. */
export function sameSlotValues(slot: AutoSlot, a: SlotValues, b: SlotValues): boolean {
  if (slot === 'tone') return sameLevels(a.levels, b.levels);
  const keys = SLOT_FIELDS[slot];
  return keys.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

function memoState(memo: AutoMemo, develop: DevelopSettings): AutoState {
  const slot = AUTO_SLOT[memo.verb];
  const now = slotValues(develop, slot);
  if (memo.off) {
    const wrote = !sameSlotValues(slot, memo.before, memo.after);
    return wrote && sameSlotValues(slot, now, memo.after) ? 'on' : 'off';
  }
  if (sameSlotValues(slot, memo.before, memo.after)) {
    // A click that changed nothing is said only while nothing has moved since;
    // once a hand moves the fields, the memo is about nothing on screen.
    return sameSlotValues(slot, now, memo.after) ? 'nothing' : 'off';
  }
  if (sameSlotValues(slot, now, memo.after)) return 'on';
  if (sameSlotValues(slot, now, memo.before)) return 'off';
  return 'edited';
}

/** What a verb's switch shows over this develop. Off whenever its slot's memo is another verb's. */
export function autoState(memos: AutoMemos, verb: AutoVerb, develop: DevelopSettings): AutoState {
  const memo = memos[AUTO_SLOT[verb]];
  if (!memo || memo.verb !== verb) return 'off';
  return memoState(memo, develop);
}

/**
 * The memos after `verb` writes `answer` over `develop`.
 *
 * While the slot is held by an auto (on, or edited since), its `before` is
 * INHERITED: turning the newer verb off then returns to the values from
 * before ANY auto of the slot — Pick grey after Auto colour gives back the
 * white balance the author had, never Auto colour's.
 */
export function recordAuto(memos: AutoMemos, verb: AutoVerb, develop: DevelopSettings, answer: SlotValues): AutoMemos {
  const slot = AUTO_SLOT[verb];
  const held = memos[slot];
  const state = held ? memoState(held, develop) : 'off';
  const before = held && (state === 'on' || state === 'edited') ? held.before : slotValues(develop, slot);
  const after = slot === 'tone' ? { levels: cloneLevels(answer.levels) } : pickSlot(slot, answer);
  return { ...memos, [slot]: { verb, before, after } };
}

function pickSlot(slot: Exclude<AutoSlot, 'tone'>, values: SlotValues): SlotValues {
  const out: SlotValues = {};
  for (const k of SLOT_FIELDS[slot]) out[k] = values[k] ?? 0;
  return out;
}

/**
 * Turning a verb's switch off: the patch that puts its slot back as it was
 * before the verb, or null when there is nothing to put back (off already, or
 * a click that changed nothing — whose memo is then dropped).
 */
export function revertAuto(
  memos: AutoMemos,
  verb: AutoVerb,
  develop: DevelopSettings,
): { memos: AutoMemos; patch: SlotValues | null; state: AutoState } {
  const slot = AUTO_SLOT[verb];
  const memo = memos[slot];
  const state = autoState(memos, verb, develop);
  if (!memo || state === 'off') return { memos, patch: null, state };
  if (state === 'nothing') {
    const rest = { ...memos };
    delete rest[slot];
    return { memos: rest, patch: null, state };
  }
  const patch = slot === 'tone' ? { levels: cloneLevels(memo.before.levels) } : pickSlot(slot, memo.before);
  // The memo is KEPT, marked: an undo of the turn-off brings `after` back and
  // must light the switch again.
  return { memos: { ...memos, [slot]: { ...memo, off: true } }, patch, state };
}
