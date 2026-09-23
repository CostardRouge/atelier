import { useEffect, useState } from 'react';
import { EXIF_SLICE_BYTES, parseExif } from '../exif/exif-parser';
import { rawSizes } from '../exif/raw-probe';
import { fileIdentity, isRawImage } from '../library/assets';
import type { SiblingFacts } from './capture-files';

/**
 * What a folder's sibling files say about themselves, read once per list:
 * whether one is an export of ours (`exif/software-mark.ts` — never offered as
 * the camera's file) and the two sizes a RAW states in its head. A sibling is
 * listed among the capture's files only once this is known, so the same read
 * serves the workbench's chip and the lightbox's switcher (R6) alike.
 *
 * Keyed by `fileIdentity`; a sibling that cannot be read is left out.
 */
export function useSiblingFacts(siblings: readonly File[]): ReadonlyMap<string, SiblingFacts> {
  const [facts, setFacts] = useState<ReadonlyMap<string, SiblingFacts>>(new Map());
  useEffect(() => {
    if (!siblings.length) {
      setFacts((cur) => (cur.size ? new Map() : cur));
      return;
    }
    let alive = true;
    void (async () => {
      const read = new Map<string, SiblingFacts>();
      for (const sibling of siblings) {
        try {
          const head = await sibling.slice(0, EXIF_SLICE_BYTES).arrayBuffer();
          const known: SiblingFacts = { software: parseExif(head).software ?? null };
          if (isRawImage(sibling.name)) {
            const sizes = await rawSizes(sibling);
            known.render = sizes.render;
            known.sensor = sizes.sensor;
          }
          read.set(fileIdentity(sibling), known);
        } catch {
          // A sibling that cannot be read is not offered.
        }
      }
      if (alive) setFacts(read);
    })();
    return () => {
      alive = false;
    };
  }, [siblings]);
  return facts;
}
