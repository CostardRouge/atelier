/**
 * The FIRST visit since atlases exist: what the page held until then — the
 * dials remembered on this browser and the flights the Library has ticked —
 * becomes the first atlas, so nothing is lost (the gallery lab's promise).
 * Done once per device: a mark in the atlas store says so, and the old dials'
 * key is dropped only after the atlas was kept.
 */

import { firstAtlas, type AtlasDoc } from './atlas-doc';
import { ingestLogs, type IngestItem } from './atlas-ingest';
import { sanitizeSettings } from './atlas-settings';
import { getValue, listAtlases, putAtlas, setValue } from './atlas-store';

/** Where the dials lived before atlases (until 2026-10-17). */
const LEGACY_SETTINGS = 'atelier.atlas.settings';
const MARK = 'first-atlas';

function legacySettings(): unknown {
  try {
    const raw = localStorage.getItem(LEGACY_SETTINGS);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

let running: Promise<AtlasDoc | null> | null = null;

/**
 * Make the first atlas when there is something to make it of; null otherwise
 * (or when it was made before). Never throws.
 */
export function ensureFirstAtlas(ticked: readonly IngestItem[], sourceId: string): Promise<AtlasDoc | null> {
  // One run per tab: a gallery mounted twice must not make two first atlases.
  running ??= makeFirst(ticked, sourceId);
  return running;
}

async function makeFirst(ticked: readonly IngestItem[], sourceId: string): Promise<AtlasDoc | null> {
  try {
    if (await getValue<boolean>(MARK)) return null;
    if ((await listAtlases()).length) {
      await setValue(MARK, true);
      return null;
    }
    const stored = legacySettings();
    if (stored === null && !ticked.length) {
      await setValue(MARK, true);
      return null;
    }
    const got = await ingestLogs(ticked);
    const doc = firstAtlas(sanitizeSettings(stored ?? {}), got.refs, got.idOf, sourceId);
    if (!(await putAtlas(doc))) return null;
    await setValue(MARK, true);
    try {
      localStorage.removeItem(LEGACY_SETTINGS);
    } catch {
      /* left behind, harmless: nothing reads it any more */
    }
    return doc;
  } catch {
    return null;
  }
}
