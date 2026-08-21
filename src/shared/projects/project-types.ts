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
import { defaultVariants, type ExportVariant } from './export-variants';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import { NO_SHIFT, type TimeShift } from '../telemetry/time-format';
import type { OutputTransform } from '../lut/transfer';

export const PROJECT_DOC_VERSION = 7;

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
  /**
   * Correction applied to the clip's capture time before any clock/date/
   * timestamp element renders it. A property of the FOOTAGE (this flight's
   * clock was an hour off), not of each badge — so one reading can never
   * contradict another. See telemetry/time-format.ts for why this is a shift
   * and not a timezone.
   */
  timeShift?: TimeShift;
}

/** The pre-v4 single-look grade, kept so old documents still parse. */
export interface SavedLut {
  selected: string;
  customName: string | null;
  customText: string | null;
  intensity: number;
}

export interface ExportPrefs {
  /** Custom base file name, or null to use the source clip's name. */
  fileName: string | null;
  variants: ExportVariant[];
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
  /** Legacy single-look grade; migrated into `lutStack` on read (v4). */
  lut: SavedLut;
  /** The grade: LUT layers in application order, each with strength + switch. */
  lutStack: SavedLutLayer[];
  /**
   * Delivery stage baked after the stack: how the graded result is re-encoded
   * for the screen it will be watched on. 'none' leaves the looks exactly as
   * authored (see shared/lut/transfer.ts).
   */
  outputTransform: OutputTransform;
  /** Title-style theme (preset + tweaks), or null for element styles as-is. */
  theme: StyleTheme | null;
  /** The export matrix: custom base name + the deliverables one press makes. */
  exportPrefs: ExportPrefs;
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
  template?: Pick<
    ProjectDoc,
    | 'elements'
    | 'guides'
    | 'lut'
    | 'lutStack'
    | 'outputTransform'
    | 'theme'
    | 'exportPrefs'
  >,
): ProjectDoc {
  const now = Date.now();
  return {
    version: PROJECT_DOC_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { aspectId, timeShift: { ...NO_SHIFT } },
    elements: template ? structuredClone(template.elements) : elements,
    guides: template ? structuredClone(template.guides) : guides,
    lut: template
      ? structuredClone(template.lut)
      : { selected: 'none', customName: null, customText: null, intensity: 1 },
    lutStack: template ? structuredClone(template.lutStack) : [],
    outputTransform: template ? template.outputTransform : 'none',
    theme: template ? structuredClone(template.theme) : null,
    exportPrefs: template
      ? structuredClone(template.exportPrefs)
      : { fileName: null, variants: defaultVariants() },
    media: { dirHandle: null, files: [], activeId: null },
    thumbnail: null,
    durationSeconds: null,
  };
}

/**
 * Bring a stored document up to the current version. v1 → v2 adds the
 * title-style theme (null: element styles as-is, visually identical);
 * v2 → v3 adds the export matrix (one source-faithful variant — exactly
 * what Export used to do); v3 → v4 turns the single look into a one-layer
 * stack, so an old project grades identically on reopen; v4 → v5 adds the
 * capture-time correction, zeroed (which is what "no correction" meant
 * before it existed); v5 → v6 adds the output transform, defaulting to
 * 'none' — an existing grade must never re-encode itself behind the user's
 * back; v6 → v7 gives every stored variant an explicit 'source' frame rate,
 * which is the only cadence an export could produce before it existed.
 * Idempotent; the store runs it on every read.
 */
export function migrateProjectDoc(doc: ProjectDoc): ProjectDoc {
  if (doc.version >= PROJECT_DOC_VERSION) return doc;
  const migrated = { ...doc };
  if (migrated.version < 2) {
    migrated.theme = migrated.theme ?? null;
  }
  if (migrated.version < 3) {
    migrated.exportPrefs = migrated.exportPrefs ?? {
      fileName: null,
      variants: defaultVariants(),
    };
  }
  if (migrated.version < 4) {
    // A v3 document's grade IS its single look — derive the stack from it
    // unless one is somehow already present.
    migrated.lutStack = migrated.lutStack?.length
      ? migrated.lutStack
      : savedLutAsStack(migrated.lut);
  }
  if (migrated.version < 5) {
    // No correction was possible before v5, so "no correction" is exactly
    // what an old project meant — clocks read identically after the upgrade.
    migrated.settings = {
      ...migrated.settings,
      timeShift: migrated.settings?.timeShift ?? { ...NO_SHIFT },
    };
  }
  if (migrated.version < 6) {
    // Off by default: a saved project must look on reopen exactly as it did
    // when it was closed.
    migrated.outputTransform = migrated.outputTransform ?? 'none';
  }
  if (migrated.version < 7) {
    // Exports followed the source cadence before v7, so that is what an old
    // variant meant — a reopened project re-renders identically.
    migrated.exportPrefs = {
      ...migrated.exportPrefs,
      variants: (migrated.exportPrefs?.variants ?? defaultVariants()).map((v) => ({
        ...v,
        frameRate: v.frameRate ?? 'source',
      })),
    };
  }
  migrated.version = PROJECT_DOC_VERSION;
  return migrated;
}

/** The v3 single-look grade as a one-layer stack (empty when it graded nothing). */
export function savedLutAsStack(lut: SavedLut | undefined): SavedLutLayer[] {
  if (!lut || lut.selected === 'none') return [];
  const isCustom = lut.selected === 'custom';
  if (isCustom && !lut.customText) return [];
  return [
    {
      id: `migrated-${lut.selected}`,
      source: isCustom ? 'custom' : `builtin:${lut.selected}`,
      name: isCustom ? (lut.customName ?? 'Custom look') : lut.selected,
      customText: isCustom ? lut.customText : null,
      intensity: lut.intensity ?? 1,
      enabled: true,
    },
  ];
}
