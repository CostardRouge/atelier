import { useEffect, useState } from 'react';
import type { WinnowConnection } from '../../shared/sources/winnow/store';
import { loadWall, type WallProgress } from './wall-cache';

export interface WallState {
  images: (ImageBitmap | null)[];
  progress: WallProgress | null;
}

const EMPTY: WallState = { images: [], progress: null };

/**
 * The wall's pictures for the series' counted `tiles`, read from this device
 * and fetched from its Winnow when missing. Empty until there are tiles: the
 * wall then keeps its colours.
 */
export function useWall(source: string | undefined, tiles: readonly number[] | undefined, connection: WinnowConnection | null): WallState {
  const [state, setState] = useState<WallState>(EMPTY);
  const key = source && tiles?.length ? `${source}|${tiles.join(',')}` : '';
  const online = connection !== null;
  useEffect(() => {
    if (!key || !source || !tiles?.length) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    setState({ images: [], progress: { done: 0, total: tiles.length, missing: 0 } });
    void loadWall(source, tiles, connection, (progress) => {
      if (!controller.signal.aborted) setState((s) => ({ ...s, progress }));
    }, controller.signal).then((images) => {
      if (!controller.signal.aborted) setState((s) => ({ ...s, images }));
    });
    return () => {
      controller.abort();
    };
    // `key` and `online` stand for the tiles and the connection: a new array of the same ids is no change.
  }, [key, online]);
  return state;
}
