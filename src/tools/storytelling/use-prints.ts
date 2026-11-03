import { useEffect, useState } from 'react';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import { loadPrints } from './wall-cache';

/**
 * The large pictures a post's blocks draw — a developed picture's original
 * and final (`story-pictures.ts`) — by Winnow id, read from this device or
 * fetched once from the connected instance (`loadPrints`). Empty while they
 * load or with none to load.
 */
export function usePrints(source: string | undefined, ids: readonly number[], connection: WinnowConnection | null): ReadonlyMap<number, CanvasImageSource> {
  const [prints, setPrints] = useState<ReadonlyMap<number, CanvasImageSource>>(EMPTY);
  const key = `${source ?? ''}|${ids.join(',')}|${connection?.id ?? ''}`;
  useEffect(() => {
    if (!source || !ids.length) {
      setPrints(EMPTY);
      return;
    }
    const controller = new AbortController();
    void loadPrints(source, ids, connection, controller.signal).then((images) => {
      if (controller.signal.aborted) return;
      const map = new Map<number, CanvasImageSource>();
      images.forEach((img, i) => img && map.set(ids[i], img));
      setPrints(map);
    });
    return () => controller.abort();
    // `key` stands for the source, the ids and the connection: a new array of the same ids is no change.
  }, [key]);
  return prints;
}
const EMPTY: ReadonlyMap<number, CanvasImageSource> = new Map();
