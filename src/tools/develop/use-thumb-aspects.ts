import { useEffect, useRef, useState } from 'react';

/**
 * The aspect of each picture's THUMBNAIL — the picture as cropped and framed,
 * which is the shape its cell is laid out at (`roll-strip.ts`, `cellAspect`).
 *
 * A thumbnail is a Blob, and a Blob says nothing about its pixels: each new
 * one is decoded once, at its own 640 px, and the number kept. Measured per
 * BLOB, so a picture whose thumbnail is retaken after a crop is measured
 * again, and a roll reopened measures nothing it already knew. The map is
 * replaced in batches, not per picture: a roll of hundreds would otherwise
 * re-lay the band once per decode.
 */
export function useThumbAspects(thumbs: ReadonlyMap<string, Blob>): ReadonlyMap<string, number> {
  const [aspects, setAspects] = useState<ReadonlyMap<string, number>>(new Map());
  const measured = useRef(new WeakMap<Blob, number>());
  const known = useRef(new Map<string, Blob>());

  useEffect(() => {
    if (typeof createImageBitmap !== 'function') return;
    const due: [string, Blob][] = [];
    for (const [id, blob] of thumbs) {
      if (known.current.get(id) === blob) continue;
      due.push([id, blob]);
    }
    if (due.length === 0) return;
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
        let aspect = measured.current.get(blob);
        if (aspect === undefined) {
          try {
            const bitmap = await createImageBitmap(blob);
            aspect = bitmap.width > 0 && bitmap.height > 0 ? bitmap.width / bitmap.height : 0;
            bitmap.close();
          } catch {
            // A thumbnail the browser cannot decode keeps the crop's own shape.
            aspect = 0;
          }
          measured.current.set(blob, aspect);
        }
        known.current.set(id, blob);
        if (aspect > 0) found.set(id, aspect);
        if (found.size >= 12) flush();
      }
      flush();
    })();
    return () => {
      alive = false;
    };
  }, [thumbs]);

  return aspects;
}
