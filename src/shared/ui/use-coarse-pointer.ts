import { useSyncExternalStore } from 'react';
import { fingerSize } from './press';
import { useIsCompact } from './use-layout-mode';

const QUERY = '(pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function coarseNow(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;
}

/**
 * Whether the primary pointer is a finger — live, so a tablet that gains a
 * trackpad (or loses it) re-sizes its controls. Width says nothing about the
 * hand: an iPad in landscape is a wide shell.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, coarseNow, () => false);
}

/** The control size for the hand in use (`fingerSize`): `md` for a finger, `sm` for a mouse. */
export function useFingerSize(): 'md' | 'sm' {
  return fingerSize(useIsCompact(), useCoarsePointer());
}
