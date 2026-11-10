/**
 * Who owns a key pressed over an EDITOR — its stage, its selection, its
 * transport — while no sheet is up.
 *
 * The fifth of the suite's key-ownership modules, beside `transport-keys.ts`
 * (space), `dialog-keys.ts` (Enter and Escape of a sheet), `undo-keys.ts`
 * (⌘Z) and `zoom-keys.ts` (Z and the arrows over a picture looked at). Each
 * editor used to write this decision by hand, by TAG: Recap stood down for
 * any focused `BUTTON`, so after the first click of a session Space pressed
 * that button again instead of playing, and Enter pressed «Frame on the
 * stage» again instead of ending the framing it had started; Mosaic stood
 * down for any `INPUT`, so a slider left focused by a drag swallowed every
 * key after it. One reading, here, for every editor:
 *
 * - **Space** is the transport's, under `targetOwnsSpace`.
 * - **Enter** ends what is in hand (a framing, a crop). A place where text is
 *   typed keeps it, and so does a control the KEYBOARD is on — its own
 *   activation key. A control a click merely left focused does not: the
 *   pointer went to the stage long ago (the 2026-09-23 rule for space).
 * - **Escape** lets go. Only a text field or an open select keeps it.
 * - **The arrows** move what is selected. A field, a slider, a select and
 *   the ARIA widgets that walk with arrows keep them, however they were
 *   focused: a slider just dragged is nudged by its own arrows.
 * - **Delete**, **Home**, **End** and a **character** (`?`, `h`, `+`, `0`…)
 *   yield to a place where text is typed, and a character to a select too
 *   (its type-ahead).
 *
 * A modified press (⌘, Ctrl, Alt) is never an editor's: ⌘Z is the history's,
 * ⌥→ the browser's. Pure and DOM-free: the hook feeds it a plain record.
 */

import { targetOwnsSpace, targetTakesText, type KeyTarget } from '../media/transport-keys';

/** The half of a `KeyboardEvent` the decision needs. */
export interface EditorKeyPress {
  key: string;
  repeat: boolean;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: KeyTarget | null;
}

export type EditorKeyName = 'space' | 'enter' | 'escape' | 'left' | 'right' | 'up' | 'down' | 'delete' | 'home' | 'end' | 'char';

/** A press an editor may act on. */
export interface EditorKey {
  name: EditorKeyName;
  /** The character typed, lower-cased — only for `char` (`?`, `h`, `+`, `0`). */
  char: string;
  shift: boolean;
  /** A held key: only the arrows repeat (a nudge), everything else is one press. */
  repeat: boolean;
  /** For an arrow: the direction as a unit step, `[dx, dy]`; `[0, 0]` otherwise. */
  dx: number;
  dy: number;
}

const ARROWS: Record<string, [EditorKeyName, number, number]> = {
  ArrowLeft: ['left', -1, 0],
  ArrowRight: ['right', 1, 0],
  ArrowUp: ['up', 0, -1],
  ArrowDown: ['down', 0, 1],
};

/** Enter is the element's own activation key (when the keyboard is on it). */
const ENTER_TAGS = new Set(['BUTTON', 'A', 'SUMMARY', 'OPTION']);
const ENTER_ROLES = new Set(['button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'switch', 'tab']);

/** Widgets whose value or place the arrows move. */
const ARROW_ROLES = new Set([
  'combobox',
  'grid',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'searchbox',
  'slider',
  'spinbutton',
  'tab',
  'tablist',
  'textbox',
  'tree',
  'treeitem',
]);

const isSelect = (t: KeyTarget | null) => t?.tagName === 'SELECT';
const roleIn = (t: KeyTarget | null, set: ReadonlySet<string>) => t !== null && t.role !== null && set.has(t.role.toLowerCase());

/** Text is typed here, or a select's list is open on it: Enter commits it, Escape closes it. */
function targetHoldsText(t: KeyTarget | null): boolean {
  return targetTakesText(t) || isSelect(t);
}

/** True when the focused element has the stronger claim to Enter (`editor-keys.ts`'s head says why). */
export function targetOwnsEditorEnter(t: KeyTarget | null): boolean {
  if (!t) return false;
  if (targetHoldsText(t)) return true;
  // An `<input>` that holds no text (a slider, a checkbox) does nothing of its own on Enter.
  const activated = ENTER_TAGS.has(t.tagName) || roleIn(t, ENTER_ROLES);
  return activated && t.focusedByKeyboard !== false;
}

/** True when the focused element moves with the arrows itself. */
export function targetOwnsArrows(t: KeyTarget | null): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return roleIn(t, ARROW_ROLES);
}

/**
 * What a key press means to an editor, or null when it is not the editor's:
 * already handled, modified, or better claimed by the focused element.
 */
export function editorKeyOf(press: EditorKeyPress): EditorKey | null {
  if (press.defaultPrevented) return null;
  if (press.altKey || press.ctrlKey || press.metaKey) return null;
  const t = press.target;
  const out = (name: EditorKeyName, extra: Partial<EditorKey> = {}): EditorKey => ({ name, char: '', shift: press.shiftKey, repeat: press.repeat, dx: 0, dy: 0, ...extra });

  const arrow = ARROWS[press.key];
  if (arrow) return targetOwnsArrows(t) ? null : out(arrow[0], { dx: arrow[1], dy: arrow[2] });
  // Everything below is ONE press: a held key would toggle, confirm or delete for ever.
  if (press.repeat) return null;
  switch (press.key) {
    case ' ':
    case 'Spacebar':
      return targetOwnsSpace(t) ? null : out('space');
    case 'Enter':
      return targetOwnsEditorEnter(t) ? null : out('enter');
    case 'Escape':
      return targetHoldsText(t) ? null : out('escape');
    case 'Delete':
    case 'Backspace':
      return targetHoldsText(t) ? null : out('delete');
    case 'Home':
      return targetOwnsArrows(t) ? null : out('home');
    case 'End':
      return targetOwnsArrows(t) ? null : out('end');
    default:
      // One printable character; a named key («Tab», «F5», «Shift») is longer than one.
      if ([...press.key].length !== 1) return null;
      return targetHoldsText(t) ? null : out('char', { char: press.key.toLowerCase() });
  }
}

/** `?` or `H`: the key that opens — and closes — an editor's sheet of keys (Develop's rule). */
export function isHelpKey(key: EditorKey): boolean {
  return key.name === 'char' && (key.char === '?' || key.char === 'h');
}
