/**
 * Dragging a picture out of the Library and onto something that wants one —
 * a collage's cell, the stage itself. Pure: it reads and writes a
 * `DataTransfer`-shaped object and keeps one module-level value, so both ends
 * can be tested without a browser.
 *
 * Two channels, on purpose:
 *
 * - the `DataTransfer` carries a KEY under our own MIME type. It is what the
 *   browser needs to allow a drop at all, and what tells our drag apart from a
 *   file dragged in from the desktop (which the sidebar's drop zone takes) —
 *   never a file, which would make the browser offer to open it. `dragover`
 *   can only read its TYPES, so asking (`hasAssetDrag`) and reading
 *   (`draggedAssetId`) are two calls;
 * - the DRAG ITEM lives here, in memory, for the length of the drag. The page
 *   that started a drag is the page that receives it, so it can carry what a
 *   `DataTransfer` cannot: the picture's name for the drop target's label,
 *   and a `resolve` that hands over the file — at once for a picture already
 *   in the Library, after a fetch for a tile an instance still holds. Every
 *   surface reads it through `subscribeAssetDrag`, which is what lets a drop
 *   target light up before the pointer ever reaches it.
 */

export const ASSET_DRAG_TYPE = 'application/x-atelier-asset';

/** Minimal shape of the bits of `DataTransfer` this module touches. */
export interface DragData {
  types: readonly string[];
  setData: (type: string, data: string) => void;
  getData: (type: string) => string;
  effectAllowed?: string;
  dropEffect?: string;
}

/** The picture a drop hands over. */
export interface DroppedAsset {
  /** The Library asset it is (or just became). */
  assetId: string;
  /** The file to compose over. */
  file: File;
}

/** What is being dragged, for as long as it is. */
export interface AssetDragItem {
  /** The source's own key — the row or tile that dims while it travels. */
  key: string;
  /** The picture's name, as a drop target says it. */
  label: string;
  /**
   * Where the picture is: `library` lands at once, `instance` is fetched on
   * drop, so the target shows it arriving rather than a drop that did nothing.
   */
  origin: 'library' | 'instance';
  /** The instance it is fetched from, for what the target says while it waits. */
  sourceLabel?: string;
  /** The picture itself — null when it could not be had (the reason is the source's to show). */
  resolve: () => Promise<DroppedAsset | null>;
}

/** What a drop target is told once the picture is (or is not) in place. */
export type DropResult = { ok: true } | { ok: false; reason: string };

/**
 * Announce that this drag carries a library asset. `text/plain` rides along
 * with the same key: a drop outside the app then pastes something inert
 * rather than nothing, and some browsers refuse a drag with no standard type.
 */
export function startAssetDrag(data: DragData, key: string): void {
  data.setData(ASSET_DRAG_TYPE, key);
  data.setData('text/plain', key);
  data.effectAllowed = 'copy';
}

/** Whether a drag in flight carries one of our assets — all `dragover` may ask. */
export function hasAssetDrag(data: Pick<DragData, 'types'> | null | undefined): boolean {
  return Boolean(data?.types?.includes(ASSET_DRAG_TYPE));
}

/** The key a drop carries, or null when it carries something else. */
export function draggedAssetId(
  data: Pick<DragData, 'types' | 'getData'> | null | undefined,
): string | null {
  if (!data || !hasAssetDrag(data)) return null;
  const id = data.getData(ASSET_DRAG_TYPE).trim();
  return id || null;
}

// --- the drag in flight ------------------------------------------------------

let current: AssetDragItem | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/**
 * A drag's end is only reported to its SOURCE — and a source can be gone by
 * then (a tile disabled while its picture is fetched, a row filtered out, a
 * day that changed), which left every target lit up for good (measured). So
 * the page watches too: a drop anywhere ends it once the target has read the
 * item, and so does the first pointer movement after, since no pointer event
 * is dispatched while a drag is in progress.
 */
function watchForTheEnd(item: AssetDragItem): void {
  if (typeof window === 'undefined') return;
  const endThis = () => {
    window.removeEventListener('drop', onDrop, true);
    window.removeEventListener('dragend', endThis, true);
    window.removeEventListener('pointermove', endThis, true);
    if (current === item) endAssetDrag();
  };
  // Deferred: this listener runs BEFORE the target's own drop handler.
  const onDrop = () => window.setTimeout(endThis, 0);
  window.addEventListener('drop', onDrop, true);
  window.addEventListener('dragend', endThis, true);
  window.addEventListener('pointermove', endThis, true);
}

/** Start a drag: mark the transfer, and make the item readable by every target. */
export function beginAssetDrag(data: DragData, item: AssetDragItem): void {
  startAssetDrag(data, item.key);
  current = item;
  emit();
  watchForTheEnd(item);
}

/**
 * The drag is over, dropped or not. `dragend` fires on the source whatever
 * happened, so this is where the item is let go — a target keeps its own
 * copy for as long as its drop takes.
 */
export function endAssetDrag(): void {
  if (current === null) return;
  current = null;
  emit();
}

/** The item being dragged right now, or null. */
export function activeAssetDrag(): AssetDragItem | null {
  return current;
}

/** Shaped for `useSyncExternalStore`. */
export function subscribeAssetDrag(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
