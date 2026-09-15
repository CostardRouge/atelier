/**
 * The house style this build ships: `house-style.json`, when it exists.
 *
 * Read through `import.meta.glob` so the file may be ABSENT — the factory
 * look, and nothing to commit — without an import that fails the build.
 *
 * The dev server's save rewrites that file under a running app. This module
 * accepts the update itself and swaps the value in place, so saving never
 * reloads the page the author is composing in: the next trip created simply
 * starts from the new style. Everything that reads it asks at creation time.
 */

import { readHouseStyle, type TripHouseStyle } from './house-style';

const found = import.meta.glob<unknown>('./house-style.json', { eager: true, import: 'default' });

let current: TripHouseStyle | null = readHouseStyle(Object.values(found)[0] ?? null);

/** The committed house style, or null for the factory look. */
export function bundledHouseStyle(): TripHouseStyle | null {
  return current;
}

if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    const fresh = next?.bundledHouseStyle as typeof bundledHouseStyle | undefined;
    if (fresh) current = fresh();
  });
}
