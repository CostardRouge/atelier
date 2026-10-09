/**
 * Cloning a trip: the same document under another name, in any source.
 *
 * A clone is what a backup file already is — `toTripFile` keeps everything the
 * author made (days, legs, pieces, looks, words, theme, the car, the covers)
 * and drops what only means something to the original (its id, its source, its
 * timestamps, a piece's Studio project) — so it is built through the file and
 * `tripDocFromFile`, never by a second serialiser that would drift from it.
 * What the file does NOT cover is handled here:
 *
 * - **Post ids are new.** The hook thumbnails live in their own store keyed by
 *   post id, and deleting a trip prunes the thumbnails of ITS posts: a clone
 *   that shared ids would lose its covers the day the original is deleted, and
 *   the original would lose its own the day the clone is. The cover's pins are
 *   remapped to the new ids, and `thumbIds` says which thumbnail to copy where.
 * - **`cameraNames`** is a `TripDoc` field the file does not carry; it is the
 *   author's naming of each camera body and belongs to the trip.
 *
 * Pure and DOM-free.
 */

import { newId, type TripDoc } from './trip-types';
import { toTripFile, tripDocFromFile } from './trip-file';

export interface TripClone {
  /** The new document: fresh id, fresh timestamps, `sourceId` of the target. */
  doc: TripDoc;
  /** Old post id → new post id: which hook thumbnail goes under which key. */
  thumbIds: ReadonlyMap<string, string>;
}

export function cloneTrip(
  trip: TripDoc,
  options: { name: string; sourceId: string; now?: number },
): TripClone {
  const now = options.now ?? Date.now();
  const made = tripDocFromFile(toTripFile(trip, now), now, options.sourceId);
  const thumbIds = new Map<string, string>();
  const posts = made.posts.map((post) => {
    const id = newId();
    thumbIds.set(post.id, id);
    return { ...post, id };
  });
  const doc: TripDoc = {
    ...made,
    name: options.name.trim(),
    posts,
    cover: {
      ...made.cover,
      // A pin naming no post is skipped by the card anyway; mapping the ones
      // that do exist keeps the clone's cover on the pieces the author chose.
      pinned: made.cover.pinned.flatMap((id) => {
        const next = thumbIds.get(id);
        return next ? [next] : [];
      }),
    },
    ...(trip.cameraNames ? { cameraNames: { ...trip.cameraNames } } : {}),
  };
  return { doc, thumbIds };
}
