import { useEffect, useRef, useState } from 'react';

/**
 * The aspect of each picture's THUMBNAIL — the picture as cropped and framed,
 * which is the shape its cell is laid out at (`roll-strip.ts`, `cellAspect`).
 *
 * A thumbnail is a Blob, and a Blob says nothing about its pixels. The host
 * says what it KNOWS (`known`): the aspect kept beside the bytes in the store
 * (`roll-store.ts`, `ThumbRecord.aspect`) or read off the canvas a thumbnail
 * was just baked on (`roll-thumb.ts`, `BakedThumb`), handed over in the same
 * render as the blob. A blob with no known aspect — one stored before the
 * aspect was kept beside it — is decoded once, at its own 640 px, the number
 * kept and said through `onMeasured` so the host can write it beside the
 * bytes: a roll reopened then lays its band out from `known` and decodes
 * nothing (2026-10-06; before, every thumbnail of a roll was decoded at open
 * to measure it). The map is replaced in batches, not per picture: a roll of
 * hundreds would otherwise re-lay the band once per decode.
 */
export function useThumbAspects(
  thumbs: ReadonlyMap<string, Blob>,
  known: ReadonlyMap<string, number> | null = null,
  onMeasured: ((id: string, aspect: number) => void) | null = null,
): ReadonlyMap<string, number> {
  const [aspects, setAspects] = useState<ReadonlyMap<string, number>>(new Map());
  const measured = useRef(new WeakMap<Blob, number>());
  const seen = useRef(new Map<string, Blob>());
  const report = useRef(onMeasured);
  report.current = onMeasured;

  useEffect(() => {
    const due: [string, Blob][] = [];
    const taken = new Map<string, number>();
    for (const [id, blob] of thumbs) {
      if (seen.current.get(id) === blob) continue;
      // What the host knows about THIS blob, else what was measured on it
      // (a blob handed back after an undo), else a decode.
      const stored = measured.current.get(blob) ?? known?.get(id);
      if (stored !== undefined && stored > 0) {
        measured.current.set(blob, stored);
        seen.current.set(id, blob);
        taken.set(id, stored);
        continue;
      }
      due.push([id, blob]);
    }
    if (taken.size > 0) {
      setAspects((cur) => {
        let next: Map<string, number> | null = null;
        for (const [id, a] of taken) {
          if (cur.get(id) === a) continue;
          next ??= new Map(cur);
          next.set(id, a);
        }
        return next ?? cur;
      });
    }
    if (due.length === 0 || typeof createImageBitmap !== 'function') return;
    let alive = true;
    void (async () => {
      const found = new Map<string, number>();
      const flush = () => {
        if (!alive || found.size === 0) return;
        const batch = new Map(found);
        found.clear();
        setAspects((cur) => {
          const next = new Map(cur);
          for (const [id, a] of batch) next.set(id, a);
          return next;
        });
      };
      for (const [id, blob] of due) {
        if (!alive) return;
        let aspect: number;
        try {
          const bitmap = await createImageBitmap(blob);
          aspect = bitmap.width > 0 && bitmap.height > 0 ? bitmap.width / bitmap.height : 0;
          bitmap.close();
        } catch {
          // A thumbnail the browser cannot decode keeps the crop's own shape.
          aspect = 0;
        }
        measured.current.set(blob, aspect);
        seen.current.set(id, blob);
        if (aspect > 0) {
          report.current?.(id, aspect);
          found.set(id, aspect);
        }
        if (found.size >= 12) flush();
      }
      flush();
    })();
    return () => {
      alive = false;
    };
  }, [thumbs, known]);

  return aspects;
}
