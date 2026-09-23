/**
 * What took this picture, read from the file in hand — the one hook every
 * surface that wants a photograph's own numbers goes through.
 *
 * It is NEVER stored on a document. A trip's pictures are re-exported,
 * re-graded and swapped under the posts that point at them (the whole reason a
 * post is keyed by its day and not by a file name), so a stored credit would
 * be a copy that quietly stops describing the photograph beside it. Reading it
 * costs the head of one file, once per picture, and it is always true.
 *
 * `readEffectiveExif` is what makes it work on a fetched picture at all: a
 * Winnow photo proxy is a re-encode with no metadata, and the instance's own
 * account of the capture is merged under the file's own bytes there.
 *
 * A clip is not read from disk — an mp4 has no EXIF head to find — but a
 * source that vouched for one still gets to speak, exactly as the library's
 * lightbox does it.
 *
 * It lives in `shared/` because it has two consumers: Road Trip's badge credit
 * and the Develop stage's capture line. A tool never reaches into another tool
 * — the second consumer is what moves a brick down here, the same move
 * `exif-parser.ts` and `StylePanel` made.
 */

import { useEffect, useState } from 'react';
import type { ExifData } from './exif-parser';
import { readEffectiveExif, vouchedExif } from './read-exif';

/**
 * `file`'s effective EXIF — its own bytes over what its source vouched for —
 * or null while it is being read and for a picture that says nothing. Null is
 * the honest answer here: a caller leaves its line out rather than drawing a
 * blank one or inventing a body.
 */
export function useEffectiveExif(file: File | null): ExifData | null {
  const [exif, setExif] = useState<ExifData | null>(null);

  useEffect(() => {
    if (!file) {
      setExif(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setExif(vouchedExif(file)?.exif ?? null);
      return;
    }
    let alive = true;
    // Never cleared first: a re-read of the same picture (a fresh `File` for
    // the same asset) would blink the line out of the badge and back in.
    void readEffectiveExif(file).then(({ exif: read }) => {
      if (alive) setExif(read);
    });
    return () => {
      alive = false;
    };
  }, [file]);

  return exif;
}
