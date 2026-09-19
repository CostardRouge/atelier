/**
 * A list of presets, edited — whoever keeps it. A trip keeps one today; the
 * personal list the maintainer chose for every Develop host (the Trips modal,
 * the Studio modal and the Develop tool, `docs/develop-tool.md`) keeps the
 * same shape, so the rules live once, here.
 *
 * A preset holds a COPY of numbers: applied, never followed. Pure and DOM-free.
 */

import { cloneDevelop, isDefaultDevelop, type DevelopPreset, type DevelopSettings } from './develop';

/**
 * The list with a preset holding a copy of `settings` under `name`. A name
 * already taken is replaced IN PLACE (keeping its id and its position), so
 * saving "Desert noon" twice is one preset with the newer numbers. A blank
 * name or an as-shot develop changes nothing — a preset of zeros is a button
 * that does nothing — and the same list comes back, so a caller can skip the
 * write.
 */
export function savePresetIn(
  list: readonly DevelopPreset[],
  name: string,
  settings: DevelopSettings | null,
  id: string,
): readonly DevelopPreset[] {
  const label = name.trim();
  if (!settings || isDefaultDevelop(settings) || !label) return list;
  // A name is a name however it is cased: "dusk" replaces "Dusk", in the new spelling.
  const existing = list.findIndex((p) => p.name.trim().toLowerCase() === label.toLowerCase());
  const preset: DevelopPreset = {
    id: existing >= 0 ? list[existing].id : id,
    name: label,
    settings: cloneDevelop(settings),
  };
  return existing >= 0 ? list.map((p, i) => (i === existing ? preset : p)) : [...list, preset];
}

/** The list without preset `id`; the same list when it holds none. No picture it was applied to changes. */
export function removePresetFrom(list: readonly DevelopPreset[], id: string): readonly DevelopPreset[] {
  return list.some((p) => p.id === id) ? list.filter((p) => p.id !== id) : list;
}
