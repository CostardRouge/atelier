/**
 * The atlas's NAMED PRESETS (his ask, 2026-10-14: «enregistrer et rappeler
 * des jeux de réglages — look, caméra, chorégraphie»): every dial under a
 * name of his own, kept on this browser beside the dials themselves
 * (`use-atlas-settings.ts`) — a convenience, never a document.
 *
 * A preset holds HOW the atlas draws, never WHAT it draws: the dials that
 * name one set of flights — the title and subtitle, the place and the zone
 * framed, the flights picked for the spotlight, the drones' names — are left
 * out when it is saved and kept from the screen when it is applied, so a
 * preset made over Perth dresses a set of Guadeloupe flights without
 * dragging Perth's words or box with it.
 *
 * Pure and tested; read back through `sanitizeSettings`, so a preset saved by
 * an older build can never break the screen.
 */

import { sanitizeSettings, type AtlasSettings } from './atlas-settings';

export interface AtlasPreset {
  id: string;
  name: string;
  settings: AtlasSettings;
  savedAt: number;
}

/** How many presets a browser keeps — far past use, short of a runaway list. */
export const MAX_PRESETS = 60;

/** The longest name kept. */
export const MAX_NAME = 48;

/** The dials that belong to one set of flights, put back from the screen on apply. */
function withContentOf(target: AtlasSettings, content: AtlasSettings): AtlasSettings {
  return {
    ...target,
    camera: {
      ...target.camera,
      place: content.camera.place,
      zone: content.camera.zone,
      picked: content.camera.picked,
    },
    hud: { ...target.hud, title: content.hud.title, subtitle: content.hud.subtitle },
    aircraft: content.aircraft,
  };
}

const EMPTY_CONTENT: AtlasSettings = sanitizeSettings({});

/** What a preset keeps of the dials on screen: everything but the content. */
export function presetSettings(settings: AtlasSettings): AtlasSettings {
  return withContentOf(settings, EMPTY_CONTENT);
}

/** The dials once a preset is applied: its look, the screen's content. */
export function applyPreset(current: AtlasSettings, preset: AtlasPreset): AtlasSettings {
  return sanitizeSettings(withContentOf(preset.settings, current));
}

/** True when the dials on screen are exactly a preset's — the chip that is lit. */
export function isCurrent(current: AtlasSettings, preset: AtlasPreset): boolean {
  return JSON.stringify(presetSettings(sanitizeSettings(current))) === JSON.stringify(presetSettings(preset.settings));
}

/** A name as it is kept: trimmed, one space between words, bounded. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/** The preset already carrying `name`, compared without case — what a save replaces. */
export function presetNamed(list: readonly AtlasPreset[], name: string): AtlasPreset | null {
  const wanted = cleanName(name).toLocaleLowerCase();
  return list.find((p) => p.name.toLocaleLowerCase() === wanted) ?? null;
}

/**
 * The list with the dials on screen saved under `name`: a preset of that
 * name is REPLACED in place (keeping its id and its rank), else a new one
 * goes first. Null for an empty name.
 */
export function savePreset(
  list: readonly AtlasPreset[],
  name: string,
  settings: AtlasSettings,
  now: number,
  makeId: () => string,
): AtlasPreset[] | null {
  const clean = cleanName(name);
  if (!clean) return null;
  const kept = presetSettings(sanitizeSettings(settings));
  const same = presetNamed(list, clean);
  if (same) return list.map((p) => (p.id === same.id ? { ...p, name: clean, settings: kept, savedAt: now } : p));
  return [{ id: makeId(), name: clean, settings: kept, savedAt: now }, ...list].slice(0, MAX_PRESETS);
}

/** The list without the preset `id`. */
export function removePreset(list: readonly AtlasPreset[], id: string): AtlasPreset[] {
  return list.filter((p) => p.id !== id);
}

/** Presets read back from storage: anything malformed dropped, every dial sanitised. */
export function readPresets(raw: unknown): AtlasPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: AtlasPreset[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, name, settings, savedAt } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id || ids.has(id) || typeof name !== 'string' || !cleanName(name)) continue;
    ids.add(id);
    out.push({
      id,
      name: cleanName(name),
      settings: presetSettings(sanitizeSettings(settings)),
      savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0,
    });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}
