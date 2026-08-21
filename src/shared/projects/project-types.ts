/**
 * The studio's project document — what IndexedDB persists between sessions.
 *
 * A project splits in two halves (see docs/memory/studio.md):
 * - the PORTABLE half (the template): overlay elements, guides, LUT choice,
 *   composition settings — reusable with any media;
 * - the BOUND half (the instance): the media directory handle, the media list
 *   (name + size + mtime, never the bytes) and the active clip.
 *
 * Directory handles are structured-cloneable, so the whole document goes into
 * IndexedDB as-is. Media bytes are NEVER copied into storage — the gallery
 * renders from a thumbnail baked at save time.
 */

import type { OverlayElement } from '../overlay/overlay-types';
import type { GuidesState } from '../overlay/guides';
import type { StyleTheme } from '../overlay/title-styles';
import type { PersistedDirectoryHandle } from '../sources/file-sources';

export const PROJECT_DOC_VERSION = 2;

/** Identity of one media file, enough to re-match it inside a folder. */
export interface SavedMediaRef {
  name: string;
  size: number;
  lastModified: number;
}

export interface AspectPreset {
  id: string;
  /** Destination-named, the way a creator thinks ("Reels", not "1080×1920"). */
  label: string;
  w: number;
  h: number;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: '9:16', label: 'Reels · TikTok · Shorts', w: 9, h: 16 },
  { id: '16:9', label: 'YouTube · landscape', w: 16, h: 9 },
  { id: '1:1', label: 'Square post', w: 1, h: 1 },
  { id: '4:5', label: 'Portrait post', w: 4, h: 5 },
];

export interface ProjectSettings {
  /**
   * Composition aspect. Stored and shown from phase 2; it drives actual
   * framing when composition templates land (phase 4) — until then the studio
   * edits at source aspect.
   */
  aspectId: string;
}

/** The LUT half of `useLutSelection`, in a persistable shape. */
export interface SavedLut {
  selected: string;
  customName: string | null;
  customText: string | null;
  intensity: number;
}

export interface ProjectMedia {
  /** Chromium only; null when the folder was picked via the fallback input. */
  dirHandle: PersistedDirectoryHandle | null;
  files: SavedMediaRef[];
  /** Base name (asset id) of the clip that was active when last saved. */
  activeId: string | null;
}

export interface ProjectDoc {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  // --- portable half -------------------------------------------------------
  elements: OverlayElement[];
  guides: GuidesState;
  lut: SavedLut;
  /** Title-style theme (preset + tweaks), or null for element styles as-is. */
  theme: StyleTheme | null;
  // --- bound half ----------------------------------------------------------
  media: ProjectMedia;
  // --- baked gallery facts (usable without the media) ----------------------
  thumbnail: Blob | null;
  durationSeconds: number | null;
}

export function savedMediaRef(file: File): SavedMediaRef {
  return { name: file.name, size: file.size, lastModified: file.lastModified };
}

/** A fresh document; pass `template` to copy its portable half. */
export function createProjectDoc(
  name: string,
  aspectId: string,
  elements: OverlayElement[],
  guides: GuidesState,
  template?: Pick<ProjectDoc, 'elements' | 'guides' | 'lut' | 'theme'>,
): ProjectDoc {
  const now = Date.now();
  return {
    version: PROJECT_DOC_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { aspectId },
    elements: template ? structuredClone(template.elements) : elements,
    guides: template ? structuredClone(template.guides) : guides,
    lut: template
      ? structuredClone(template.lut)
      : { selected: 'none', customName: null, customText: null, intensity: 1 },
    theme: template ? structuredClone(template.theme) : null,
    media: { dirHandle: null, files: [], activeId: null },
    thumbnail: null,
    durationSeconds: null,
  };
}

/**
 * Bring a stored document up to the current version. v1 → v2 adds the
 * title-style theme (null: element styles as-is, visually identical).
 * Idempotent; the store runs it on every read.
 */
export function migrateProjectDoc(doc: ProjectDoc): ProjectDoc {
  if (doc.version >= PROJECT_DOC_VERSION) return doc;
  const migrated = { ...doc };
  if (migrated.version < 2) {
    migrated.theme = migrated.theme ?? null;
  }
  migrated.version = PROJECT_DOC_VERSION;
  return migrated;
}
