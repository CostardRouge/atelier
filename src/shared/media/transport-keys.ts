/**
 * Who owns a key press.
 *
 * Space is the suite's transport key (play/pause), bound on `window` so it
 * works wherever the pointer happens to be. But space is also the browser's
 * *activation* key for buttons and a typing character in every field, so a
 * global handler has to stand down whenever the focused element has a better
 * claim to the press. This is the pure half of that decision — the hook feeds
 * it a plain description of the event target so it stays DOM-free and testable.
 */

export interface KeyTarget {
  /** Uppercase tag name, as `HTMLElement.tagName` gives it. */
  tagName: string;
  isContentEditable: boolean;
  /** Explicit ARIA role, or null. */
  role: string | null;
  /**
   * An `<input>`'s own `type`, lowercased; null on everything else. The letter
   * shortcuts do not read it — an input is an input to them — but space and
   * ⌘Z do: a slider is an input that holds no text, so it has neither typing
   * to protect nor an undo of its own (`undo-keys.ts`).
   */
  inputType?: string | null;
  /**
   * Whether the KEYBOARD put the focus here, rather than a click leaving it
   * behind. Absent means "assume it did": an environment that cannot answer
   * keeps the old, safe behaviour.
   */
  focusedByKeyboard?: boolean;
}

/** Space types a character, or moves a control's value. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * `<input type>`s that hold no text: space ACTIVATES them (or does nothing at
 * all, on a range), so they are judged like a button rather than like a field.
 * Everything else an `<input>` can be — text, search, url, number, date… —
 * takes a space character and keeps the key unconditionally.
 */
const ACTIVATED_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Space activates the element itself (native controls included). */
const ACTIVATED_TAGS = new Set([
  'BUTTON',
  'SUMMARY',
  'OPTION',
  'VIDEO', // `<video controls>`: the browser already plays/pauses it.
  'AUDIO',
]);

/** Widgets that behave like the tags above without using them. */
const ACTIVATED_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

/**
 * True when the focused element has a stronger claim to a space press than the
 * transport does — the transport must then ignore the key entirely (no toggle,
 * and no `preventDefault`, or the button would never fire).
 */
export function targetOwnsSpace(target: KeyTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const typing = TYPING_TAGS.has(target.tagName);
  if (typing && !(target.tagName === 'INPUT' && isActivatedInput(target))) return true;
  const activated =
    typing ||
    ACTIVATED_TAGS.has(target.tagName) ||
    (target.role !== null && ACTIVATED_ROLES.has(target.role.toLowerCase()));
  // A control the KEYBOARD is on owns the key it is aimed at. A control merely
  // left focused by a click does not: the pointer went somewhere else long ago,
  // and a press of the transport key then means the transport — not that tab,
  // that pill or that slider handle, pressed again.
  return activated && target.focusedByKeyboard !== false;
}

function isActivatedInput(target: KeyTarget): boolean {
  const type = target.inputType ?? 'text';
  return ACTIVATED_INPUT_TYPES.has(type);
}

/**
 * True when the focused element is somewhere text is being typed — the guard
 * every *letter* shortcut needs (`I`/`O` for the trim handles, Delete for the
 * selected element). Narrower than {@link targetOwnsSpace} on purpose: a
 * button doesn't own the letter `i`, and treating it as if it did would kill
 * those shortcuts for the rest of the session after any button click.
 */
export function targetOwnsTyping(target: KeyTarget | null): boolean {
  if (!target) return false;
  return target.isContentEditable || TYPING_TAGS.has(target.tagName);
}

/** Describe a DOM event target for the two predicates above. */
export function describeKeyTarget(target: EventTarget | null): KeyTarget | null {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return null;
  return {
    tagName: el.tagName,
    isContentEditable: el.isContentEditable === true,
    role: el.getAttribute?.('role') ?? null,
    inputType: el.tagName === 'INPUT' ? (el.getAttribute?.('type') ?? 'text').toLowerCase() : null,
    focusedByKeyboard: !focusCameFromPointer,
  };
}

/**
 * How the focus got where it is — watched here, once, for the whole suite.
 *
 * `:focus-visible` is the obvious answer and is UNUSABLE for this: measured in
 * Chrome 152, a button focused by a click matches `:focus-visible` as soon as
 * any key is pressed on it, so by the time a keydown handler asks, the browser
 * has already changed its mind. What is stable is the gesture that moved the
 * focus, so that is what is recorded: a `focusin` that follows a `pointerdown`
 * closely enough is the pointer's, anything else is the keyboard's. Programmatic
 * focus inside a click handler counts as the pointer's, which is what it is.
 */
let focusCameFromPointer = false;

/** A focus within this long after a press belongs to that press. */
const POINTER_FOCUS_MS = 400;

if (typeof document !== 'undefined') {
  let pressedAt = -Infinity;
  const press = () => {
    pressedAt = performance.now();
    // A press that focuses nothing new still ends the keyboard's claim: the
    // element left focused is now stale (the pointer moved the attention).
    focusCameFromPointer = true;
  };
  document.addEventListener('pointerdown', press, true);
  document.addEventListener('focusin', () => {
    focusCameFromPointer = performance.now() - pressedAt < POINTER_FOCUS_MS;
  }, true);
}
