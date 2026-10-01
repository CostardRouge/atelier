import { useMemo } from 'react';
import { sectionValues } from '../../shared/develop/journal';
import { PICTURE_EDITS, type RollPicture } from '../../shared/develop/roll-types';
import { pictureChapters, type PictureChapters } from '../../shared/develop/timelapse-chapters';

/**
 * A picture's chapters, memoised on what they are MADE of — its journal and
 * its sections — and not on the picture object, which every write replaces:
 * a making-of edit (a chapter hidden, a caption rewritten) or a title typed
 * changes neither, and the chapters' STATES keep their identity, which is what
 * lets the painter keep their rasters (`timelapse-paint.ts`, `StateCache`).
 */
export function usePictureChapters(picture: RollPicture, aspectRatio: number): PictureChapters {
  const journal = picture.journal;
  const sectionsKey = useMemo(() => JSON.stringify(sectionValues(picture, PICTURE_EDITS)), [picture]);
  // `picture` is read for the fields `sectionsKey` and `journal` stand for.
  return useMemo(() => pictureChapters(picture, aspectRatio), [journal, sectionsKey, aspectRatio]);
}
