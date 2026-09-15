/**
 * The house style this build ships: `house-style.json`, when it exists.
 *
 * Read through `import.meta.glob` so the file may be ABSENT — the factory
 * look, and nothing to commit — without an import that fails the build. The
 * dev server's save rewrites it under a running app; the module accepts that
 * update itself and the value stays live (`held-across-updates.ts`), so the
 * next trip created starts from the new style without a reload.
 */

import { heldAcrossUpdates } from '../lib/held-across-updates';
import { readHouseStyle } from './house-style';

const found = import.meta.glob<unknown>('./house-style.json', { eager: true, import: 'default' });

/** The committed house style, or null for the factory look. */
export const bundledHouseStyle = heldAcrossUpdates(
  import.meta.hot,
  readHouseStyle(Object.values(found)[0] ?? null),
);

if (import.meta.hot) import.meta.hot.accept();
