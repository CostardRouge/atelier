/**
 * The Develop editor's rules that are not drawing — which picture is open,
 * what a key means, whether a develop changed. Pure and DOM-free; the editor
 * (`tools/develop/RollEditor.tsx`) feeds it plain descriptions.
 */

export type WorkbenchTab = 'adjust' | 'detail' | 'layers' | 'crop' | 'export';

/** The inspector's tabs, in order — the SAME list drives the desktop strip and the phone's bottom bar. */
export const WORKBENCH_TABS: readonly { id: WorkbenchTab; label: string }[] = [
  { id: 'adjust', label: 'Adjust' },
  { id: 'detail', label: 'Detail' },
  { id: 'layers', label: 'Layers' },
  { id: 'crop', label: 'Crop' },
  { id: 'export', label: 'Export' },
];

/** The picture the editor shows: the one the route names, else the first; null on an empty roll. */
export function openPictureId(pictures: readonly { id: string }[], routeId: string | null): string | null {
  if (routeId && pictures.some((p) => p.id === routeId)) return routeId;
  return pictures[0]?.id ?? null;
}

/**
 * The picture `step` away along the strip, held at its ends (never wrapping:
 * the end of a roll is a place). A picture `skip` answers true for — an
 * IGNORED one — is stepped over, from wherever the step starts: opened by a
 * click, an ignored picture still hands the arrows on to the next that is not.
 * With nothing further in that direction, the step stays where it is.
 */
export function stepPicture<T extends { id: string }>(
  pictures: readonly T[],
  currentId: string | null,
  step: number,
  skip: (picture: T) => boolean = () => false,
): string | null {
  if (pictures.length === 0) return null;
  const at = Math.max(0, pictures.findIndex((p) => p.id === currentId));
  if (step === 0) return pictures[at].id;
  const dir = Math.sign(step);
  let left = Math.abs(step);
  let i = at;
  let landed = at;
  while (left > 0) {
    i += dir;
    if (i < 0 || i >= pictures.length) break;
    if (skip(pictures[i])) continue;
    landed = i;
    left -= 1;
  }
  return pictures[landed].id;
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

/**
 * Two stored develops say the same thing — null and an untouched set are the
 * same "as shot". The comparison itself is engine-level (`develop.ts`): the
 * record stopped being flat numbers when it gained curves and levels, and a
 * key-by-key `===` would call two identical curves different.
 */
export { sameDevelop } from './develop';

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
  /** The Layers tab is open — where `P` and `M` are the mask's keys, not the delivery's. */
  layersTab?: boolean;
}

export type EditorKeyAction =
  | 'previous'
  | 'next'
  | 'hold'
  | 'zoom'
  | 'copy'
  | 'paste'
  | { tab: WorkbenchTab }
  | 'swap'
  | 'crop-view'
  | 'help'
  | 'facts'
  | 'mask'
  | 'pick'
  | 'remove'
  | 'escape'
  | 'deliver'
  | 'deliver-auto'
  | 'ignore'
  | null;

/**
 * The letter each inspector tab answers to — its own initial, which is what
 * makes the set learnable in one reading: `A`djust, `D`etail, `L`ayers,
 * `C`rop, `E`xport. `R` used to open the crop and named nothing.
 */
const TAB_KEYS: Readonly<Record<string, WorkbenchTab>> = {
  a: 'adjust',
  d: 'detail',
  l: 'layers',
  c: 'crop',
  e: 'export',
};

/**
 * What a key press means in the editor, or null when it belongs to someone
 * else. ←/→ move along the strip, `\` holds "before" (its release is the
 * caller's), `Z` goes closer or back to the fit, a tab's own initial opens it
 * (`TAB_KEYS`, answered as `{ tab }`), `X` swaps the crop's orientation, ⇧C
 * crops to the zoomed view (the caller decides whether there is one), `H`
 * (or `?`) the shortcuts, `I` the facts over the picture, `M` the mask's view
 * and `P` Pick / Paint (both on the Layers tab, the caller's rule), ⌘/Ctrl-C and -V
 * copy and paste the develop — the chord is read first, so ⌘C stays copy while
 * a bare `C` opens the crop. Delete or Backspace REMOVES what is selected on
 * the picture (a repair patch) and Escape lets go of it — what each applies
 * to is the caller's, which knows what is selected. A field or a slider keeps
 * every key it could use; a held arrow does step (it is how a strip is
 * swept), a held `\` does not re-press.
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
  // `?` is the one key reached WITH shift on most layouts, so it is read
  // before the blanket refusal below: a help key nobody can press is not one.
  if (press.key === '?') return press.repeat ? null : 'help';
  // ⇧C crops to what a zoomed view shows: the crop's own letter, shifted,
  // because it MAKES a crop without opening the tab. The only other shift chord.
  if (press.shiftKey && (press.key === 'C' || press.key === 'c')) return press.repeat ? null : 'crop-view';
  if (press.shiftKey) return null;
  if (press.key === 'ArrowLeft') return 'previous';
  if (press.key === 'ArrowRight') return 'next';
  if (press.repeat) return null;
  if (press.key === 'Delete' || press.key === 'Backspace') return 'remove';
  if (press.key === 'Escape') return 'escape';
  if (press.key === '\\') return 'hold';
  if (press.key === 'z' || press.key === 'Z') return 'zoom';
  const tab = TAB_KEYS[press.key.toLowerCase()];
  if (tab) return { tab };
  // The crop's portrait ↔ landscape; the editor answers it on the Crop tab only.
  if (press.key === 'x' || press.key === 'X') return 'swap';
  if (press.key === 'h' || press.key === 'H') return 'help';
  if (press.key === 'i' || press.key === 'I') return 'facts';
  // `P` and `M` mean two things, by where the author is (2026-09-23, the
  // maintainer's merge of #183 and #185): on the LAYERS tab they are the
  // mask's — `M` steps its view (hidden, outline, fill), `P` turns Pick or
  // Paint on and off, so a hand on the picture never reaches for the
  // inspector; everywhere else they are the delivery state's
  // (`docs/lightroom-gaps.md` §10) — `P` sends ↔ holds, `M` ignores. `U`
  // puts the picture back on the roll's rule on every tab. Letters, so an
  // AZERTY board presses the same ones.
  if (press.key === 'p' || press.key === 'P') return press.layersTab ? 'pick' : 'deliver';
  if (press.key === 'm' || press.key === 'M') return press.layersTab ? 'mask' : 'ignore';
  if (press.key === 'u' || press.key === 'U') return 'deliver-auto';
  return null;
}
