/**
 * The Develop editor's rules that are not drawing — which picture is open,
 * what a key means, whether a develop changed. Pure and DOM-free; the editor
 * (`tools/develop/RollEditor.tsx`) feeds it plain descriptions.
 */

import { DEFAULT_DEVELOP, type DevelopSettings } from './develop';

/** The picture the editor shows: the one the route names, else the first; null on an empty roll. */
export function openPictureId(pictures: readonly { id: string }[], routeId: string | null): string | null {
  if (routeId && pictures.some((p) => p.id === routeId)) return routeId;
  return pictures[0]?.id ?? null;
}

/** The picture `step` away along the strip, held at its ends (never wrapping: the end of a roll is a place). */
export function stepPicture(pictures: readonly { id: string }[], currentId: string | null, step: number): string | null {
  if (pictures.length === 0) return null;
  const at = Math.max(0, pictures.findIndex((p) => p.id === currentId));
  return pictures[Math.max(0, Math.min(pictures.length - 1, at + step))].id;
}

/**
 * What to open once `removedId` leaves the strip: the same picture if another
 * one went, else the one that took its place, else the one before it.
 */
export function openAfterRemoval(
  pictures: readonly { id: string }[],
  removedId: string,
  openId: string | null,
): string | null {
  if (openId !== removedId) return openId;
  const at = pictures.findIndex((p) => p.id === removedId);
  const rest = pictures.filter((p) => p.id !== removedId);
  if (rest.length === 0) return null;
  return rest[Math.min(Math.max(at, 0), rest.length - 1)].id;
}

/** Two stored develops say the same thing — null and an untouched set are the same "as shot". */
export function sameDevelop(a: DevelopSettings | null, b: DevelopSettings | null): boolean {
  const x = { ...DEFAULT_DEVELOP, ...(a ?? {}) } as Record<string, number>;
  const y = { ...DEFAULT_DEVELOP, ...(b ?? {}) } as Record<string, number>;
  return Object.keys({ ...x, ...y }).every((k) => x[k] === y[k]);
}

/** The pictures between `a` and `b`, inclusive, in strip order; an id off the roll reads as just the other end. */
export function pictureRange(pictures: readonly { id: string }[], a: string, b: string): string[] {
  const ia = pictures.findIndex((p) => p.id === a);
  const ib = pictures.findIndex((p) => p.id === b);
  if (ia < 0 || ib < 0) return [b];
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return pictures.slice(lo, hi + 1).map((p) => p.id);
}

export interface SelectionModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * What a MODIFIED filmstrip click does to the batch selection — a plain click
 * never reaches this, it opens the picture instead. Shift REPLACES the
 * selection with the range from the anchor (repeated shift-clicks do not
 * accumulate, the anchor does not move); ⌘/Ctrl toggles one picture in place
 * and becomes the anchor for the next shift-click.
 */
export function selectionAfterClick(
  pictures: readonly { id: string }[],
  selected: ReadonlySet<string>,
  anchor: string,
  id: string,
  mods: SelectionModifiers,
): ReadonlySet<string> {
  if (mods.shiftKey) return new Set(pictureRange(pictures, anchor, id));
  if (mods.metaKey || mods.ctrlKey) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  return selected;
}

export interface EditorKeyPress {
  key: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** The focused element types or moves a value (an input, a slider, a select). */
  targetTypes: boolean;
  /** Text is selected on the page: ⌘C copies THAT, not the develop. */
  hasSelection: boolean;
}

export type EditorKeyAction = 'previous' | 'next' | 'hold' | 'zoom' | 'copy' | 'paste' | null;

/**
 * What a key press means in the editor, or null when it belongs to someone
 * else. ←/→ move along the strip, `\` holds "before" (its release is the
 * caller's), `Z` goes closer or back to the fit, ⌘/Ctrl-C and -V copy and
 * paste the develop. A field or a slider keeps every key it could use; a
 * held arrow does step (it is how a strip is swept), a held `\` does not
 * re-press.
 */
export function editorKeyAction(press: EditorKeyPress): EditorKeyAction {
  if (press.targetTypes || press.altKey) return null;
  const mod = press.metaKey || press.ctrlKey;
  if (mod) {
    if (press.shiftKey) return null;
    const k = press.key.toLowerCase();
    if (k === 'c') return press.hasSelection ? null : 'copy';
    if (k === 'v') return 'paste';
    return null;
  }
  if (press.shiftKey) return null;
  if (press.key === 'ArrowLeft') return 'previous';
  if (press.key === 'ArrowRight') return 'next';
  if (press.repeat) return null;
  if (press.key === '\\') return 'hold';
  if (press.key === 'z' || press.key === 'Z') return 'zoom';
  return null;
}
