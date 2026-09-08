import { useEffect, useRef, useState } from 'react';

/**
 * Object URLs for a small, moving set of files — created as the set grows,
 * revoked as it shrinks, and all of them dropped on unmount.
 *
 * `URL.createObjectURL` reads nothing: it registers a handle. What it does do
 * is pin that handle until it is revoked, which is why this takes the files it
 * should hold right now rather than a whole library — a caller keeps a window
 * around what is on screen and the rest is let go.
 *
 * The map must be referentially stable (a `useMemo`): it is the effect's
 * dependency, and a fresh map every render would revoke and recreate every
 * URL, which is exactly the flicker this exists to avoid.
 */
export function useObjectUrls(files: ReadonlyMap<string, File>): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  // The file each URL was made from, so a key whose file was REPLACED gets a
  // new URL rather than an old one that no longer points at those bytes.
  const held = useRef(new Map<string, { file: File; url: string }>());

  useEffect(() => {
    const next = new Map(held.current);
    let changed = false;
    for (const [key, entry] of held.current) {
      if (files.get(key) === entry.file) continue;
      URL.revokeObjectURL(entry.url);
      next.delete(key);
      changed = true;
    }
    for (const [key, file] of files) {
      if (next.has(key)) continue;
      next.set(key, { file, url: URL.createObjectURL(file) });
      changed = true;
    }
    held.current = next;
    if (changed) setUrls(new Map([...next].map(([key, entry]) => [key, entry.url])));
  }, [files]);

  useEffect(
    () => () => {
      for (const entry of held.current.values()) URL.revokeObjectURL(entry.url);
      held.current = new Map();
    },
    [],
  );

  return urls;
}
