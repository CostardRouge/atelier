import { useCallback, useEffect, useRef, useState } from 'react';
import { pruneMarks, withExported, type ExportMarks } from '../../shared/develop/export-marks';
import type { RollPicture } from '../../shared/develop/roll-types';
import { getExportMarks, putExportMarks } from '../../shared/develop/roll-store';

const NONE: ExportMarks = Object.freeze({});

/**
 * A roll's export marks (`export-marks.ts`), live: read from this device's
 * store when the roll opens, written when a run's files land. Never through
 * the roll's updater — a mark is not an edit and must not be an undo step.
 */
export function useExportMarks(rollId: string, pictureIds: readonly string[]) {
  const [marks, setMarks] = useState<ExportMarks>(NONE);
  const loadedFor = useRef<string | null>(null);
  const ids = useRef(pictureIds);
  ids.current = pictureIds;

  useEffect(() => {
    let live = true;
    loadedFor.current = null;
    setMarks(NONE);
    void getExportMarks(rollId).then((stored) => {
      if (!live) return;
      loadedFor.current = rollId;
      setMarks(stored);
    });
    return () => {
      live = false;
    };
  }, [rollId]);

  /** The files of `pictures` landed at `at`: mark each as it was rendered, and keep the marks. */
  const record = useCallback(
    (pictures: readonly RollPicture[], at: number) => {
      setMarks((current) => {
        const next = pruneMarks(withExported(current, pictures, at), ids.current);
        void putExportMarks(rollId, next, at);
        return next;
      });
    },
    [rollId],
  );

  return { marks, record };
}
