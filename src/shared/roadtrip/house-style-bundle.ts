/**
 * The house style this build ships: `house-style.json`, when it exists.
 *
 * Read through `import.meta.glob` so the file may be ABSENT — the factory
 * look, and nothing to commit — without an import that fails the build.
 *
 * The dev server's save rewrites that file under a running app. This module
 * accepts the update itself, so saving never reloads the page the author is
 * composing in: the next trip created simply starts from the new style.
 *
 * The value lives in a holder kept in `import.meta.hot.data`, which survives
 * every re-evaluation, and each new instance writes into it. A callback that
 * copies the new value into the old instance is NOT enough: only the latest
 * instance's callback runs, so from the second save on it would update an
 * instance nobody imports any more.
 */

import { readHouseStyle, type TripHouseStyle } from './house-style';

const found = import.meta.glob<unknown>('./house-style.json', { eager: true, import: 'default' });

const holder: { style: TripHouseStyle | null } = import.meta.hot?.data.holder ?? { style: null };
holder.style = readHouseStyle(Object.values(found)[0] ?? null);

if (import.meta.hot) {
  import.meta.hot.data.holder = holder;
  import.meta.hot.accept();
}

/** The committed house style, or null for the factory look. */
export function bundledHouseStyle(): TripHouseStyle | null {
  return holder.style;
}
