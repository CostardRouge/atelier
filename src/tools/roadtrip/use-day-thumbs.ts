import { useEffect, useMemo, useState } from 'react';
import { getThumbs } from '../../shared/roadtrip/trip-store';
import type { TripPost } from '../../shared/roadtrip/trip-types';

/**
 * The stored hooks of a day's pieces, as object URLs — what the day panel
 * and the day strip both draw, so it is read once and both see the same map.
 *
 * Keyed on the ids so switching day reloads, and every URL is revoked on the
 * way out: an unrevoked blob URL holds its bytes for the lifetime of the
 * document.
 */
export default function useDayThumbs(posts: readonly TripPost[]): ReadonlyMap<string, string> {
  const ids = useMemo(() => posts.map((p) => p.id).join('|'), [posts]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void getThumbs(ids ? ids.split('|') : []).then((blobs) => {
      const next = new Map<string, string>();
      for (const [id, blob] of blobs) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next.set(id, url);
      }
      if (alive) setThumbs(next);
      else for (const url of urls) URL.revokeObjectURL(url);
    });
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [ids]);
  return thumbs;
}
