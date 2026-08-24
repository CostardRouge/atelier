import { useEffect, useState } from 'react';
import { EXIF_SLICE_BYTES, parseExif, type ExifData } from '../../shared/exif/exif-parser';

/**
 * Read and parse the EXIF block from the head of an image file, lazily and
 * cancellably. Returns `undefined` while reading, then an {@link ExifData}
 * (possibly empty when the file carries no metadata). Only the first slice of
 * the file is read — the full image is never decoded here, and nothing is
 * uploaded.
 *
 * `enabled` gates the work so a gallery card can defer it until it scrolls into
 * view, matching the rest of the suite's lazy loading.
 */
export function useExif(file: File | null, enabled = true): ExifData | undefined {
  const [exif, setExif] = useState<ExifData | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !file) return;
    let cancelled = false;
    setExif(undefined);
    file
      .slice(0, EXIF_SLICE_BYTES)
      .arrayBuffer()
      .then((buf) => {
        if (!cancelled) setExif(parseExif(buf));
      })
      .catch(() => {
        if (!cancelled) setExif({});
      });
    return () => {
      cancelled = true;
    };
  }, [file, enabled]);

  return exif;
}
