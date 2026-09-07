import { useEffect, useState } from 'react';
import { readEffectiveExif, type EffectiveExif } from '../../shared/exif/read-exif';

/**
 * Read one photo's EXIF, lazily and cancellably. Returns `undefined` while
 * reading, then an {@link EffectiveExif} whose `exif` may be empty (a file
 * that carries no metadata, handed over by nobody).
 *
 * The read goes through `read-exif.ts`, so a picture fetched from a connected
 * instance shows what that instance parsed at ingest: its proxy is a WebP
 * re-encode with no EXIF at all, and reading the bytes alone would report "no
 * metadata" about a photograph whose camera, exposure and capture time are
 * known. `via` says which instance vouched, so the panel never presents a
 * column as if it had come out of the file.
 *
 * `enabled` gates the work so a gallery card can defer it until it scrolls
 * into view, matching the rest of the suite's lazy loading.
 */
export function useExif(file: File | null, enabled = true): EffectiveExif | undefined {
  const [exif, setExif] = useState<EffectiveExif | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !file) return;
    let cancelled = false;
    setExif(undefined);
    void readEffectiveExif(file).then((read) => {
      if (!cancelled) setExif(read);
    });
    return () => {
      cancelled = true;
    };
  }, [file, enabled]);

  return exif;
}
