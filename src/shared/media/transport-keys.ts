/**
 * Who owns the space bar.
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
}

/** Space types a character, or moves a control's value. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

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
  if (TYPING_TAGS.has(target.tagName)) return true;
  if (ACTIVATED_TAGS.has(target.tagName)) return true;
  return target.role !== null && ACTIVATED_ROLES.has(target.role.toLowerCase());
}
