/**
 * Static manifest of the `.cube` LUTs bundled in `public/luts/`.
 *
 * Static hosting (GitHub Pages) can't list a directory at runtime, so the set
 * of built-in LUTs is declared here. `import.meta.env.BASE_URL` makes the paths
 * resolve under the deployed base (`/dji-flight-data/`) as well as in dev.
 *
 * To add a LUT: drop a `.cube` into `public/luts/` (see that folder's README,
 * or extend `scripts/gen-luts.mjs`) and add an entry below.
 */

export interface BuiltinLut {
  /** Stable id used as the <select> value. */
  id: string;
  /** Human label shown in the picker. */
  name: string;
  /** Fetchable URL of the `.cube` file. */
  url: string;
}

const lutUrl = (file: string) => `${import.meta.env.BASE_URL}luts/${file}`;

export const BUILTIN_LUTS: BuiltinLut[] = [
  { id: 'neutral', name: 'Neutral (identity)', url: lutUrl('neutral.cube') },
  { id: 'warm', name: 'Warm', url: lutUrl('warm.cube') },
  { id: 'cool', name: 'Cool', url: lutUrl('cool.cube') },
  { id: 'filmic-contrast', name: 'Filmic Contrast', url: lutUrl('filmic-contrast.cube') },
  { id: 'bw', name: 'Black & White', url: lutUrl('bw.cube') },
  { id: 'sepia', name: 'Sepia', url: lutUrl('sepia.cube') },
];
