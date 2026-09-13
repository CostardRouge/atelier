import { useEffect, useMemo, useRef, useState } from 'react';
import { hookDayPosts } from '../../shared/roadtrip/hooks/hook-calendar';
import type {
  HookContext,
  HookLayer,
  HookPicture,
  HookPictureWant,
} from '../../shared/roadtrip/hooks/hook-variant';
import { hookVariantById } from '../../shared/roadtrip/hooks/registry';
import type { TripDoc, TripPost } from '../../shared/roadtrip/trip-types';
import { getThumbs } from '../../shared/roadtrip/trip-store';

const NONE: ReadonlyMap<string, HookPicture> = new Map();

/**
 * How long a replaced set of bitmaps is kept before it is closed. A render
 * already in flight — `renderBadge` awaits the fonts before it draws, and an
 * export runs for seconds — may still hold the old set, and drawing a closed
 * `ImageBitmap` throws. The stage's own rule is "one commit after"; a picture
 * set also feeds exports, so it waits longer.
 */
const RELEASE_AFTER_MS = 4000;

/**
 * The pictures a piece's opener asked for (`needs.media === 'day'`), decoded.
 *
 * The source is the thumbs store — the small JPEG every post keeps of its own
 * hook — which is local, already graded and framed the way that piece was
 * composed, and one read per day. A flash lasts a few video frames, so a
 * 640px picture stretched over the frame is not what anyone sees; decoding
 * each day's original capture would be. Only the pictures the variant WANTS
 * are read (`wantsPictures`) — a day each, and the piece it named where it
 * named one — never the trip's whole list.
 */
export default function useHookPictures(
  trip: TripDoc,
  post: TripPost,
  layers: readonly HookLayer[],
  ctx: HookContext,
): ReadonlyMap<string, HookPicture> {
  // The days wanted, and the piece standing for each — as one string, so the
  // load re-runs when the ANSWER changes and not on every edit of the piece.
  const wanted = useMemo(() => {
    // A later layer naming a piece for a day wins over an earlier one that did
    // not — the fold's own rule (`foldHook`: the last layer that speaks).
    const wants = new Map<string, HookPictureWant>();
    for (const layer of layers) {
      const variant = hookVariantById(layer.id);
      if (variant?.needs.media !== 'day' || !variant.wantsPictures) continue;
      for (const want of variant.wantsPictures(layer.options ?? {}, ctx)) {
        const have = wants.get(want.date);
        wants.set(want.date, { date: want.date, postId: want.postId ?? have?.postId });
      }
    }
    const byDay = hookDayPosts(trip, [...wants.values()], post.id);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [layers, ctx, trip, post.id]);
  const key = wanted.map(([date, id]) => `${date}:${id}`).join(',');

  const [pictures, setPictures] = useState<ReadonlyMap<string, HookPicture>>(NONE);

  useEffect(() => {
    let cancelled = false;
    if (!wanted.length) {
      setPictures(NONE);
      return;
    }
    void (async () => {
      const blobs = await getThumbs(wanted.map(([, id]) => id));
      const next = new Map<string, HookPicture>();
      for (const [date, id] of wanted) {
        const blob = blobs.get(id);
        if (!blob) continue;
        try {
          const bitmap = await createImageBitmap(blob);
          if (cancelled) {
            bitmap.close();
            continue;
          }
          next.set(date, { image: bitmap, width: bitmap.width, height: bitmap.height });
        } catch {
          // A thumbnail that does not decode is a day with nothing to show,
          // which the paint already draws honestly.
        }
      }
      if (cancelled) {
        for (const picture of next.values()) (picture.image as ImageBitmap).close();
        return;
      }
      setPictures(next);
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on `key`, which carries everything `wanted` says: the array itself
    // is a new object on every memo, and loading again for it would re-decode
    // the same pictures on every edit of the piece.
  }, [key]);

  // Release a replaced set — late, see RELEASE_AFTER_MS.
  const current = useRef<ReadonlyMap<string, HookPicture>>(NONE);
  useEffect(() => {
    const previous = current.current;
    current.current = pictures;
    if (previous === pictures || previous === NONE) return;
    // Never cancelled: a set replaced twice in quick succession must still be
    // closed, and closing a bitmap after unmount is harmless.
    window.setTimeout(() => {
      for (const picture of previous.values()) (picture.image as ImageBitmap).close();
    }, RELEASE_AFTER_MS);
  }, [pictures]);

  useEffect(
    () => () => {
      for (const picture of current.current.values()) (picture.image as ImageBitmap).close();
    },
    [],
  );

  return pictures;
}
