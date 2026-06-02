import { useSyncExternalStore } from 'react';

/**
 * Minimal hash-based router for the tool suite.
 *
 * Hash routing (`…/#/lut`) is the pragmatic fit for static hosting (GitHub
 * Pages): the path before the `#` is just the deploy base, so deep-links work
 * with no `404.html`/SPA-fallback. Two routes, no nesting — a 20-line hook
 * beats pulling in a router dependency.
 */

/** Current route path (the hash minus its leading `#`), e.g. `/lut`. */
function currentPath(): string {
  return window.location.hash.replace(/^#/, '');
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Subscribe to the active route path; re-renders on `hashchange`. */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '');
}

/** Navigate to a route path (writes the hash; a no-op if already there). */
export function navigate(path: string): void {
  if (window.location.hash !== `#${path}`) window.location.hash = path;
}
