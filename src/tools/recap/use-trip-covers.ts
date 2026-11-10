import { useEffect, useState } from 'react';
import { coverTiles } from '../../shared/roadtrip/trip-cover';
import { tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { getThumbs } from '../../shared/roadtrip/trip-store';
import type { TripDoc } from '../../shared/roadtrip/trip-types';

/** How many of a trip's cover pieces are tried before giving up on a picture. */
const TRIED = 6;

/**
 * The picture each trip of Trips shows of itself, by trip id: the first of
 * its cover's pieces (`coverTiles` — pinned, then its busiest days) that has
 * a thumbnail kept on this device. A trip with none is absent, and its card
 * draws its road instead. Read from Trips' own store, never fetched.
 */
export function useTripCovers(trips: readonly TripDoc[] | null): ReadonlyMap<string, string> {
  const [covers, setCovers] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!trips?.length) {
      setCovers(new Map());
      return;
    }
    let alive = true;
    const urls: string[] = [];
    const wanted = trips.map((trip) => ({ id: trip.id, posts: coverTiles(trip, tripCoverage(trip), () => true, TRIED).map((t) => t.postId) }));
    void getThumbs(wanted.flatMap((w) => w.posts)).then((thumbs) => {
      if (!alive) return;
      const out = new Map<string, string>();
      for (const w of wanted) {
        const blob = w.posts.map((id) => thumbs.get(id)).find(Boolean);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        out.set(w.id, url);
      }
      setCovers(out);
    });
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [trips]);
  return covers;
}
