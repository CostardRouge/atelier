/**
 * Dragging a picture out of the Library and onto something that wants one —
 * a collage's cell, the stage itself. Pure: it only reads and writes a
 * `DataTransfer`, so both ends can be tested without a browser.
 *
 * The payload is an ASSET ID, never a file: the library already holds the
 * handles, the id is what every other surface addresses a picture by, and a
 * file in the transfer would make the browser offer to open it. The MIME type
 * is our own, so a file dragged in from the desktop (which the sidebar's drop
 * zone takes) and a picture dragged out of the sidebar can never be confused.
 *
 * `dragover` cannot read the DATA — only the types — so the two halves are
 * separate: `hasAssetDrag` decides whether a drop is allowed, `draggedAssetId`
 * reads the id once the drop happens.
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

/**
 * Announce that this drag carries a library asset. `text/plain` rides along
 * with the same id: a drop outside the app then pastes something inert rather
 * than nothing, and some browsers refuse a drag with no standard type.
 */
export function startAssetDrag(data: DragData, assetId: string): void {
  data.setData(ASSET_DRAG_TYPE, assetId);
  data.setData('text/plain', assetId);
  data.effectAllowed = 'copy';
}

/** Whether a drag in flight carries one of our assets — all `dragover` may ask. */
export function hasAssetDrag(data: Pick<DragData, 'types'> | null | undefined): boolean {
  return Boolean(data?.types?.includes(ASSET_DRAG_TYPE));
}

/** The asset id a drop carries, or null when it carries something else. */
export function draggedAssetId(data: Pick<DragData, 'types' | 'getData'> | null | undefined): string | null {
  if (!hasAssetDrag(data as DragData)) return null;
  const id = data!.getData(ASSET_DRAG_TYPE).trim();
  return id || null;
}
