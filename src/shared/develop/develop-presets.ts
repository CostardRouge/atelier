/**
 * A list of presets, edited — whoever keeps it. A trip keeps one today; the
 * personal list the maintainer chose for every Develop host (the Trips modal,
 * the Studio modal and the Develop tool, `docs/develop-tool.md`) keeps the
 * same shape, so the rules live once, here.
 *
 * A preset holds a COPY of numbers: applied, never followed. Pure and DOM-free.
 */

import { DEFAULT_DEVELOP, carriesDevelop, cloneDevelop, withoutBase, type DevelopPreset, type DevelopSettings } from './develop';
import type { SavedGrade } from '../lut/saved-grade';
import { uniqueDocName } from '../sources/doc-name';

/**
 * The list with a preset holding a copy of `settings` under `name`. A name
 * already taken is replaced IN PLACE (keeping its id and its position), so
 * saving "Desert noon" twice is one preset with the newer numbers. A blank
 * name, or an as-shot develop with no look, changes nothing — a preset of
 * zeros is a button that does nothing — and the same list comes back, so a
 * caller can skip the write. A `look` rides with the light when given.
 */
export function savePresetIn(
  list: readonly DevelopPreset[],
  name: string,
  settings: DevelopSettings | null,
  id: string,
  look: SavedGrade | null = null,
): readonly DevelopPreset[] {
  const label = name.trim();
  // A preset is numbers, never a material: the base and its metered gain
  // belong to the one picture they were measured on.
  const numbers = settings ? withoutBase(settings) : null;
  // A look alone is a preset too — "just Portra" is a name worth keeping.
  if (!label || (!carriesDevelop(numbers) && !look)) return list;
  // A name is a name however it is cased: "dusk" replaces "Dusk", in the new spelling.
  const existing = list.findIndex((p) => p.name.trim().toLowerCase() === label.toLowerCase());
  const preset: DevelopPreset = {
    id: existing >= 0 ? list[existing].id : id,
    name: label,
    settings: cloneDevelop(numbers ?? DEFAULT_DEVELOP),
    ...(look ? { look: structuredClone(look) } : {}),
  };
  return existing >= 0 ? list.map((p, i) => (i === existing ? preset : p)) : [...list, preset];
}

/** The list without preset `id`; the same list when it holds none. No picture it was applied to changes. */
export function removePresetFrom(list: readonly DevelopPreset[], id: string): readonly DevelopPreset[] {
  return list.some((p) => p.id === id) ? list.filter((p) => p.id !== id) : list;
}

/**
 * The list with a COPY of preset `id` right after it, under `name` — numbered
 * by the clone rule (`doc-name.ts`: `Dusk` → `Dusk (2)`) when the name is taken,
 * so cloning never replaces a preset the way `savePresetIn` does. The copy
 * keeps the numbers and the look and shares nothing mutable with the original.
 * An unknown id or a blank name changes nothing and the same list comes back.
 */
export function clonePresetIn(
  list: readonly DevelopPreset[],
  id: string,
  name: string,
  newId: string,
): readonly DevelopPreset[] {
  const at = list.findIndex((p) => p.id === id);
  const label = uniqueDocName(name, list.map((p) => p.name));
  if (at < 0 || !label) return list;
  const from = list[at];
  const copy: DevelopPreset = {
    id: newId,
    name: label,
    settings: cloneDevelop(from.settings),
    ...(from.look ? { look: structuredClone(from.look) } : {}),
  };
  return [...list.slice(0, at + 1), copy, ...list.slice(at + 1)];
}

/**
 * The list with preset `id` under a new `name`, in place — numbered by the
 * clone rule when ANOTHER preset holds the name, never replacing it the way
 * `savePresetIn` does. A blank name, an unknown id or the same name changes
 * nothing and the same list comes back.
 */
export function renamePresetIn(list: readonly DevelopPreset[], id: string, name: string): readonly DevelopPreset[] {
  const at = list.findIndex((p) => p.id === id);
  if (at < 0 || !name.trim()) return list;
  const label = uniqueDocName(name, list.filter((p) => p.id !== id).map((p) => p.name));
  if (!label || label === list[at].name) return list;
  return list.map((p, i) => (i === at ? { ...p, name: label } : p));
}

/**
 * The list with preset `id` holding a copy of `settings` — and of `look` when
 * one is given, else none — in place, under its own name and id: "Update with
 * this picture". The base never rides (`savePresetIn`'s rule). A preset left
 * with nothing to apply (as-shot numbers and no look) is refused: the same
 * list comes back, as it does for an unknown id.
 */
export function updatePresetIn(
  list: readonly DevelopPreset[],
  id: string,
  settings: DevelopSettings | null,
  look: SavedGrade | null = null,
): readonly DevelopPreset[] {
  const at = list.findIndex((p) => p.id === id);
  if (at < 0) return list;
  const numbers = settings ? withoutBase(settings) : null;
  if (!carriesDevelop(numbers) && !look) return list;
  const preset: DevelopPreset = {
    id: list[at].id,
    name: list[at].name,
    settings: cloneDevelop(numbers ?? DEFAULT_DEVELOP),
    ...(look ? { look: structuredClone(look) } : {}),
  };
  return list.map((p, i) => (i === at ? preset : p));
}

/**
 * A removed preset put BACK where it stood (`at`, clamped to the list) — the
 * Undo of a removal. Nothing changes when its id is already there.
 */
export function restorePresetIn(list: readonly DevelopPreset[], preset: DevelopPreset, at: number): readonly DevelopPreset[] {
  if (list.some((p) => p.id === preset.id)) return list;
  const i = Math.max(0, Math.min(at, list.length));
  return [...list.slice(0, i), preset, ...list.slice(i)];
}
