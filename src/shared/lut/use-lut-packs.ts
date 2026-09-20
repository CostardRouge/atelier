import { useSyncExternalStore } from 'react';
import { packsSnapshot, subscribePacks } from './pack-vault';
import type { LutPackIndex } from './lut-pack';

/**
 * The packs this browser holds, live — the picker's and the import sheet's
 * one reader. Subscribing is what loads the vault, so nothing runs at boot
 * and a tool that never opens a look picker never touches IndexedDB.
 */
export function useLutPacks(): LutPackIndex[] {
  return useSyncExternalStore(subscribePacks, packsSnapshot, packsSnapshot);
}
