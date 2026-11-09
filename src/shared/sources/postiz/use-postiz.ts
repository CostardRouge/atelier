import { useSyncExternalStore } from 'react';
import { getPostiz, subscribePostiz, type PostizConnection } from './store';

/** The kept Postiz, live — null until one is connected on `#/sources`. */
export function usePostiz(): PostizConnection | null {
  return useSyncExternalStore(subscribePostiz, getPostiz, getPostiz);
}
