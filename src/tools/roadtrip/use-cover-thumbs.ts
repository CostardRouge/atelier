import { useEffect, useMemo, useRef, useState } from 'react';
import { tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { coverCandidateIds } from '../../shared/roadtrip/trip-cover';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { getThumbs } from '../../shared/roadtrip/trip-store';

/**
 * The hook pictures the gallery needs to draw its covers, as object URLs.
 *
 * Only the candidates (`coverCandidateIds`), never a trip's whole 250 pieces:
 * the store reads them one key at a time, and a gallery that loads every
 * thumbnail it will never draw is a gallery that opens slowly for nothing.
 *
 * The URLs are revoked when the set changes and on unmount — an object URL
 * nobody revokes holds its blob for the lifetime of the document, and these
 * are the only heavy values the tool keeps in memory.
 */
export default function useCoverThumbs(trips: readonly TripDoc[] | null): {
  urls: ReadonlyMap<string, string>;
  hasThumb: (postId: string) => boolean;
} {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const live = useRef<string[]>([]);

  // The ids as one string: the effect must re-run when the CANDIDATES change
  // (a piece added, a pin moved), not on every re-render of the list.
  const wanted = useMemo(() => {
    if (!trips) return '';
    const ids: string[] = [];
    for (const trip of trips) ids.push(...coverCandidateIds(trip, tripCoverage(trip)));
    return [...new Set(ids)].sort().join(',');
  }, [trips]);

  useEffect(() => {
    let cancelled = false;
    const ids = wanted ? wanted.split(',') : [];
    if (!ids.length) {
      setUrls(new Map());
      return;
    }
    void getThumbs(ids).then((blobs) => {
      if (cancelled) {
        return;
      }
      const next = new Map<string, string>();
      for (const [id, blob] of blobs) next.set(id, URL.createObjectURL(blob));
      // Revoke only once the new set is the one being drawn: revoking first
      // paints a broken image for a frame on every refresh.
      const stale = live.current;
      live.current = [...next.values()];
      setUrls(next);
      for (const url of stale) URL.revokeObjectURL(url);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  useEffect(
    () => () => {
      for (const url of live.current) URL.revokeObjectURL(url);
      live.current = [];
    },
    [],
  );

  return {
    urls,
    hasThumb: (postId: string) => urls.has(postId),
  };
}
