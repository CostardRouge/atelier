import { useEffect, useMemo, useRef, useState } from 'react';
import { getThumbs } from '../../shared/roadtrip/trip-store';
import type { TripPost } from '../../shared/roadtrip/trip-types';
import { thumbWindowStep } from './thumb-window';

/**
 * The stored hooks of a set of pieces, as object URLs — what the day panel,
 * the day strip and the overview's pictures view draw.
 *
 * INCREMENTAL: when the set changes, only the pieces that came in are read
 * and only the ones that left have their URL revoked (`thumb-window.ts`). The
 * pictures view slides a three-month window, and re-reading the two months
 * it already held at every month boundary made every cell flash. Every URL
 * still held is revoked on the way out: an unrevoked blob URL keeps its
 * bytes for the lifetime of the document.
 */
export default function useDayThumbs(posts: readonly TripPost[]): ReadonlyMap<string, string> {
  const ids = useMemo(() => posts.map((p) => p.id).join('|'), [posts]);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  // The URLs this hook owns, whatever the last render drew.
  const held = useRef(new Map<string, string>());
  // The ids asked for last: a read that lands after the window moved on keeps
  // only what is still wanted.
  const wanted = useRef<ReadonlySet<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const owned = held.current;
    return () => {
      mounted.current = false;
      for (const url of owned.values()) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, []);

  useEffect(() => {
    const list = ids ? ids.split('|') : [];
    wanted.current = new Set(list);
    const { missing, dropped } = thumbWindowStep(held.current.keys(), list);
    for (const id of dropped) {
      URL.revokeObjectURL(held.current.get(id)!);
      held.current.delete(id);
    }
    if (dropped.length) setThumbs(new Map(held.current));
    if (!missing.length) return;
    void getThumbs(missing).then((blobs) => {
      if (!mounted.current) return;
      let changed = false;
      for (const [id, blob] of blobs) {
        if (!wanted.current.has(id) || held.current.has(id)) continue;
        held.current.set(id, URL.createObjectURL(blob));
        changed = true;
      }
      if (changed) setThumbs(new Map(held.current));
    });
  }, [ids]);
  return thumbs;
}
