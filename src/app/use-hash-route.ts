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

/**
 * True when `path` is `base` itself or one of its sub-routes — `/roadtrip`,
 * `/roadtrip/home`, but never `/roadtrip-notes` or `/studio`.
 *
 * A tool with sub-routes redirects when it lands on an incomplete one (no
 * project open → go to the gallery). That redirect MUST be guarded by this,
 * because a tool is still mounted and still subscribed to the route at the
 * instant the hash changes to another tool's: without the guard it reads the
 * new path, decides it is not one of its own, and navigates "back" — and the
 * tool switcher silently does nothing. That was a real bug, and it looked
 * intermittent because it only bit when the tool had no document open.
 */
export function isWithinRoute(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}
