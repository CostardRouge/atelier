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

/**
 * The tabs a CLIP has (2026-09-30, the crop added 2026-10-01): Adjust, Crop
 * and Export. A clip takes the global develop, the look and a crop — what the
 * export grades and re-frames every frame through — and none of what Detail
 * and Layers write, which are passes over one still frame (`roll-types.ts`,
 * `isClipPicture`). A tab that cannot act on the picture is not drawn, and
 * its key does nothing.
 */
export const CLIP_TABS: readonly WorkbenchTab[] = ['adjust', 'crop', 'export'];

/** The inspector's tabs for the picture in hand — every one for a photograph, a clip's three for a clip. */
export function workbenchTabsFor(clip: boolean): readonly { id: WorkbenchTab; label: string }[] {
  return clip ? WORKBENCH_TABS.filter((t) => CLIP_TABS.includes(t.id)) : WORKBENCH_TABS;
}

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
  return openAfterRemovals(pictures, [removedId], openId);
}

/**
 * The same for SEVERAL pictures leaving at once (the selection's "take off
 * the roll"): the open one stays if it is not among them, else the first
 * survivor after it in strip order, else the last survivor.
 */
export function openAfterRemovals(
  pictures: readonly { id: string }[],
  removedIds: readonly string[],
  openId: string | null,
): string | null {
  if (openId === null || !removedIds.includes(openId)) return openId;
  const at = pictures.findIndex((p) => p.id === openId);
  const rest = pictures.filter((p) => !removedIds.includes(p.id));
  if (rest.length === 0) return null;
  const after = pictures.slice(at + 1).find((p) => !removedIds.includes(p.id));
  return after ? after.id : rest[rest.length - 1].id;
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
  /** The band's selection is on — where ⌘A takes every picture it shows. */
  selecting?: boolean;
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
  | 'copy-settings'
  | 'paste-settings'
  | 'clipping'
  | 'mono'
  | 'variant'
  | 'select'
  | 'select-all'
  | 'band'
  | 'sheet'
  | 'thumbs-smaller'
  | 'thumbs-larger'
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
 * (or `?`) the shortcuts, `I` the facts over the picture, `J` the clipping
 * painted on it, `V` black and white, `S` the band's selection (and ⌘A every
 * shown picture while it is on), `B` the band folded to its rail, `G` the
 * contact sheet, `-` and `=` the thumbnails smaller and larger, `M` the
 * mask's view
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
    if (press.shiftKey) {
      // ⌘⇧C / ⌘⇧V: the SECTIONS, Lightroom's chord (`picture-sections.ts`) —
      // ⌘C / ⌘V below stay the develop numbers, shared with the modals.
      const k = press.key.toLowerCase();
      if (press.repeat) return null;
      if (k === 'c') return press.hasSelection ? null : 'copy-settings';
      if (k === 'v') return 'paste-settings';
      return null;
    }
    const k = press.key.toLowerCase();
    // ⌘' — Lightroom's virtual copy: a variant of the picture as it stands
    // (item 30). The apostrophe is unshifted on QWERTY and on AZERTY (its 4).
    if (k === "'") return press.repeat ? null : 'variant';
    if (k === 'c') return press.hasSelection ? null : 'copy';
    if (k === 'v') return 'paste';
    // ⌘A takes every picture the band shows — only while its selection is
    // on, so the page's own select-all is left alone the rest of the time.
    if (k === 'a') return press.selecting && !press.repeat ? 'select-all' : null;
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
  // `S` turns the band's SELECTION on and off (`docs/develop-roll-browser.md`
  // §5): pick several pictures, then act on them all — the two-step gesture
  // that took the verbs off the cells.
  if (press.key === 's' || press.key === 'S') return 'select';
  // `B` folds the band to its rail and back; `-` and `=` (the `+` key
  // unshifted, on QWERTY and on AZERTY alike) step its thumbnails — the
  // grid's keys in Lightroom, where the stage keeps Z and the wheel.
  if (press.key === 'b' || press.key === 'B') return 'band';
  // `G` — the contact sheet over the stage and back: Lightroom's Grid.
  if (press.key === 'g' || press.key === 'G') return 'sheet';
  if (press.key === '-' || press.key === '_') return 'thumbs-smaller';
  if (press.key === '=' || press.key === '+') return 'thumbs-larger';
  // `J` paints what is clipped over the picture — Lightroom's own letter, so
  // a hand that learnt it there finds it here.
  if (press.key === 'j' || press.key === 'J') return 'clipping';
  // `V` flips colour ↔ black and white — Lightroom's letter again.
  if (press.key === 'v' || press.key === 'V') return 'mono';
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

/**
 * Which picture to OPEN after an undo or a redo put `after` back over
 * `before` (audit item 8): the undo stack is one for the whole roll, so ⌘Z
 * after stepping on could undo the previous picture — or an Apply-to on the
 * others — with nothing on screen changing. The restore is made visible by
 * going to what it changed.
 *
 * Changed means a different OBJECT: every write replaces the picture it
 * touches and keeps the others, so identity is the diff. Null — stay — when
 * the open picture is among the changed ones, or when no picture changed (a
 * roll-wide field, a name).
 */
export function pictureAfterRestore<T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  openId: string | null,
): string | null {
  const was = new Map(before.map((p) => [p.id, p]));
  const changed = after.filter((p) => was.get(p.id) !== p).map((p) => p.id);
  if (changed.length === 0 || (openId !== null && changed.includes(openId))) return null;
  return changed[0];
}
