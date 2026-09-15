/**
 * The Studio house style this build ships: `house-style.json`, when it
 * exists — the twin of `shared/roadtrip/house-style-bundle.ts`, which says why
 * it is read through a glob and accepts its own updates.
 */

import { heldAcrossUpdates } from '../lib/held-across-updates';
import { readProjectHouseStyle } from './house-style';

const found = import.meta.glob<unknown>('./house-style.json', { eager: true, import: 'default' });

/** The committed house style, or null for the factory look. */
export const bundledProjectHouseStyle = heldAcrossUpdates(
  import.meta.hot,
  readProjectHouseStyle(Object.values(found)[0] ?? null),
);

if (import.meta.hot) import.meta.hot.accept();
