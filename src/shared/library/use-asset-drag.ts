import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import {
  activeAssetDrag,
  beginAssetDrag,
  endAssetDrag,
  subscribeAssetDrag,
  type AssetDragItem,
} from './asset-drag';

/** The picture being dragged out of the Library right now, or null. */
export function useAssetDrag(): AssetDragItem | null {
  return useSyncExternalStore(subscribeAssetDrag, activeAssetDrag, () => null);
}

/**
 * What a draggable source — a Library row, a tile — wears: the handlers that
 * start and end the drag, and whether it should be drawn LIFTED (the picture
 * is travelling; its row is left as a dashed, faded outline, the way a file
 * manager shows the item being moved).
 *
 * The browser's own drag picture is a snapshot of the element — the row's
 * thumbnail and name, which is what a person expects to be carrying — so no
 * custom card is drawn: `setDragImage` could not be proven to leave a drag
 * intact in the desktop app's test browser, and a drag that silently stops
 * reaching its target is the exact fault this feature was reported for.
 *
 * `lifted` turns on ONE FRAME after the drag starts: the snapshot is taken
 * from the element as it stands when `dragstart` returns, and a row already
 * faded would make a faded picture.
 */
export function useAssetDragSource(item: AssetDragItem | null): {
  lifted: boolean;
  props:
    | { draggable: false }
    | {
        draggable: true;
        onDragStart: (e: DragEvent<HTMLElement>) => void;
        onDragEnd: () => void;
      };
} {
  const [lifted, setLifted] = useState(false);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  if (!item) return { lifted: false, props: { draggable: false } };
  return {
    lifted,
    props: {
      draggable: true,
      onDragStart: (e) => {
        beginAssetDrag(e.dataTransfer, item);
        frame.current = requestAnimationFrame(() => setLifted(true));
      },
      onDragEnd: () => {
        cancelAnimationFrame(frame.current);
        setLifted(false);
        endAssetDrag();
      },
    },
  };
}
