/**
 * What took this picture, as one line — the badge's camera credit, measured.
 *
 * The line is NEVER stored on the piece. A trip's pictures are re-exported,
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
 */

import { useEffect, useState } from 'react';
import { exposureSummary } from '../../shared/exif/exif-summary';
import { readEffectiveExif, vouchedExif } from '../../shared/exif/read-exif';

/**
 * The exposure line for `file`, or null while it is being read and for a
 * picture that says nothing. Null is the honest answer here: the badge leaves
 * the piece out rather than drawing a blank line or inventing a body.
 */
export function useExposureLine(file: File | null): string | null {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setLine(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setLine(exposureSummary(vouchedExif(file)?.exif) || null);
      return;
    }
    let alive = true;
    // Never cleared first: a re-read of the same picture (a fresh `File` for
    // the same asset) would blink the line out of the badge and back in.
    void readEffectiveExif(file).then(({ exif }) => {
      if (alive) setLine(exposureSummary(exif) || null);
    });
    return () => {
      alive = false;
    };
  }, [file]);

  return line;
}
