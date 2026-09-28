import { useSyncExternalStore } from 'react';
import type { Loupe, LoupeStore } from '../../shared/roadtrip/loupe';

const nothing = () => null;
const noSubscription = () => () => undefined;

/**
 * The stage ruler's window as the ruler last published it, for a surface that
 * DRAWS it without owning it — the year map's bar, the stages header's dates.
 * Only the reader re-renders when it moves; null without a ruler on screen.
 */
export function useLoupe(store: LoupeStore | undefined): Loupe | null {
  return useSyncExternalStore(store ? store.subscribe : noSubscription, store ? store.get : nothing, nothing);
}
