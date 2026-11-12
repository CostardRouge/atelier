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
 * The state is READ from the develop's values, never stored as a word: a
 * switch is on while its fields still hold what it wrote, off once they hold
 * what was there before (or once it was turned off), edited when anything
 * else moved them. The MEMOS (each click's before and after) ride the develop
 * itself, `DevelopSettings.auto` (2026-11-12, his ask «auto develop status
 * saved in the project»), so every host that keeps a develop keeps them, and
 * an undo — a whole develop — lights and dims the switches by itself. Pure;
 * the row's hook is `use-auto-memory.ts`.
 */
import { cloneLevels, levelsOrNull, sameLevels } from './curves';
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
  /** Turned off (`SwitchMemo.off`). */
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

/**
 * The record of one click of ANY automatic verb, over values of any shape —
 * the develop's slots here, the crop's aspect and framing in the Crop tab.
 */
export interface SwitchMemo<T> {
  before: T;
  after: T;
  /**
   * Set when the switch was turned off. From then on a hand moving the values
   * is not an edit of the verb's answer, so the switch stays off — unless the
   * values come back to `after` exactly, which is an undo of the turn-off.
   */
  off?: boolean;
}

/** What a click's switch shows over the values `now`. The one rule every automatic verb reads. */
export function switchState<T>(memo: SwitchMemo<T>, now: T, same: (a: T, b: T) => boolean): AutoState {
  if (memo.off) return !same(memo.before, memo.after) && same(now, memo.after) ? 'on' : 'off';
  // A click that changed nothing is said only while nothing has moved since;
  // once a hand moves the values, the memo is about nothing on screen.
  if (same(memo.before, memo.after)) return same(now, memo.after) ? 'nothing' : 'off';
  if (same(now, memo.after)) return 'on';
  if (same(now, memo.before)) return 'off';
  return 'edited';
}

/**
 * The `before` a new click records over `now`: while an earlier click still
 * holds the values (on, or edited since) its `before` is INHERITED, so turning
 * the newer one off returns to the values from before ANY automatic verb.
 */
function inheritedBefore<T>(held: SwitchMemo<T> | undefined, now: T, same: (a: T, b: T) => boolean): T {
  if (!held) return now;
  const state = switchState(held, now, same);
  return state === 'on' || state === 'edited' ? held.before : now;
}

function memoState(memo: AutoMemo, develop: DevelopSettings): AutoState {
  const slot = AUTO_SLOT[memo.verb];
  return switchState(memo, slotValues(develop, slot), (a, b) => sameSlotValues(slot, a, b));
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
  const before = inheritedBefore(memos[slot], slotValues(develop, slot), (a, b) => sameSlotValues(slot, a, b));
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

// --- the memos as a document keeps them (`DevelopSettings.auto`) ------------

const AUTO_VERBS: readonly AutoVerb[] = ['tone', 'colour', 'pick', 'bands'];
const AUTO_SLOTS: readonly AutoSlot[] = ['tone', 'balance', 'bands'];

/** A slot's record read back safely: levels through their reader, a number clamped to a slider's range. */
function readSlotValues(slot: AutoSlot, raw: unknown): SlotValues | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  if (slot === 'tone') return { levels: levelsOrNull(src.levels) };
  const out: SlotValues = {};
  for (const k of SLOT_FIELDS[slot]) {
    const v = src[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0;
  }
  return out;
}

/**
 * The memos a stored develop carries, read back safely; null when there are
 * none. A memo whose verb is not its slot's, or whose records are unreadable,
 * is dropped: its switch then reads off, which is what a develop saved before
 * the memos were kept shows too.
 */
export function normaliseAutoMemos(raw: unknown): AutoMemos | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: AutoMemos = {};
  for (const slot of AUTO_SLOTS) {
    const m = src[slot];
    if (!m || typeof m !== 'object') continue;
    const memo = m as Record<string, unknown>;
    const verb = memo.verb as AutoVerb;
    if (!AUTO_VERBS.includes(verb) || AUTO_SLOT[verb] !== slot) continue;
    const before = readSlotValues(slot, memo.before);
    const after = readSlotValues(slot, memo.after);
    if (!before || !after) continue;
    out[slot] = memo.off === true ? { verb, before, after, off: true } : { verb, before, after };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function cloneSlotValues(slot: AutoSlot, v: SlotValues): SlotValues {
  return slot === 'tone' ? { levels: cloneLevels(v.levels) } : { ...v };
}

/** A deep copy, so a stored develop and a draft never share a memo's levels; null when there are none. */
export function cloneAutoMemos(memos: AutoMemos | null | undefined): AutoMemos | null {
  if (!memos) return null;
  const out: AutoMemos = {};
  for (const slot of AUTO_SLOTS) {
    const m = memos[slot];
    if (!m) continue;
    out[slot] = { ...m, before: cloneSlotValues(slot, m.before), after: cloneSlotValues(slot, m.after) };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Two sets of memos say the same thing — none and an empty set alike. */
export function sameAutoMemos(a: AutoMemos | null | undefined, b: AutoMemos | null | undefined): boolean {
  return AUTO_SLOTS.every((slot) => {
    const x = a?.[slot];
    const y = b?.[slot];
    if (!x || !y) return !x && !y;
    return (
      x.verb === y.verb &&
      Boolean(x.off) === Boolean(y.off) &&
      sameSlotValues(slot, x.before, y.before) &&
      sameSlotValues(slot, x.after, y.after)
    );
  });
}
