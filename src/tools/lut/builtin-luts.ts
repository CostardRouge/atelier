/**
 * Built-in `.cube` LUTs, discovered from `public/luts/` at build time.
 *
 * The Vite `luts-manifest` plugin (see vite.config.ts) scans `public/luts`
 * recursively for `.cube` files and exposes the list as `virtual:luts`.
 * Static hosting (GitHub Pages) can't list a directory at runtime, so the scan
 * happens at build/dev time and is baked into the bundle.
 *
 * To add a LUT: drop a `.cube` into `public/luts/` (optionally in a sub-folder
 * — the folder name becomes its group in the picker). Nothing to edit here.
 */

import manifest from 'virtual:luts';

export interface BuiltinLut {
  /** Stable id used as the <select> value. */
  id: string;
  /** Human label shown in the picker. */
  name: string;
  /** Folder the LUT lives in (`''` for the `luts/` root), e.g. `apple`. */
  group: string;
  /** Fetchable URL of the `.cube` file. */
  url: string;
}

// `import.meta.env.BASE_URL` makes paths resolve under the deployed base
// (`/atelier/`) as well as in dev.
const lutUrl = (file: string) => `${import.meta.env.BASE_URL}luts/${file}`;

export const BUILTIN_LUTS: BuiltinLut[] = manifest.map((entry) => ({
  id: entry.id,
  name: entry.name,
  group: entry.group,
  url: lutUrl(entry.file),
}));

export interface LutGroup {
  /** Optgroup label, e.g. `APPLE` or `APPLE / LOG` for nested folders. */
  label: string;
  luts: BuiltinLut[];
}

/** Builtins at the `luts/` root — rendered as plain options, before groups. */
export const UNGROUPED_LUTS: BuiltinLut[] = BUILTIN_LUTS.filter((l) => !l.group);

/** Folder-grouped builtins, each an `<optgroup>` with an uppercased label. */
export const LUT_GROUPS: LutGroup[] = (() => {
  const byGroup = new Map<string, BuiltinLut[]>();
  for (const lut of BUILTIN_LUTS) {
    if (!lut.group) continue;
    const list = byGroup.get(lut.group);
    if (list) list.push(lut);
    else byGroup.set(lut.group, [lut]);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, luts]) => ({
      label: group
        .split('/')
        .map((s) => s.toUpperCase())
        .join(' / '),
      luts,
    }));
})();
