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
import { DEFAULT_GUIDES, type GuidesState } from '../overlay/guides';
import type { StyleTheme } from '../overlay/title-styles';
import type { Scene } from '../overlay/scenes';
import type { OutroCard } from '../overlay/outro-card';
import type { PersistedDirectoryHandle } from '../sources/file-sources';
import { defaultVariants, type ExportVariant } from './export-variants';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import { NO_SHIFT, type TimeShift } from '../telemetry/time-format';
import { AUTO_TIME_SCALE, type TimeScaleSetting } from '../telemetry/time-scale';
import type { OutputTransform } from '../lut/transfer';
import type { SavedTrim } from '../media/trim';

export const PROJECT_DOC_VERSION = 13;

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
  /**
   * How fast the clip plays against life. Conformed footage (slow motion,
   * time-lapse) divides real distances by stretched seconds, so every derived
   * rate — ground speed, vertical speed — would be wrong without it. `auto`
   * follows what the telemetry measures; manual covers the clips nothing can
   * measure. Like `timeShift`, a property of the FOOTAGE rather than of a badge.
   * See telemetry/time-scale.ts.
   */
  timeScale?: TimeScaleSetting;
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
  /**
   * In/out points per clip, keyed by base name — only for the clips that are
   * actually trimmed. Bound, not portable: seconds into *this* footage mean
   * nothing under another media, which is why each entry carries the duration
   * it was set against (see media/trim.ts, `restoreTrim`). Per clip rather
   * than per project because the maintainer trims several clips of one flight
   * and exports them one by one to assemble later.
   */
  trims: Record<string, SavedTrim>;
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
  /**
   * Scenes — today the introduction, which lends its elements one window, an
   * optional scrim and the power to hold the HUD back while it plays. Portable:
   * an intro is part of the template, not of the footage.
   */
  scenes: Scene[];
  /**
   * The outro — a closing card appended after the footage on every variant
   * that carries the overlays. Portable like the intro: a closing card is
   * part of the template, not of the footage. Null = the export ends on the
   * footage's last frame, exactly as before the card existed.
   */
  outro: OutroCard | null;
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
    | 'scenes'
    | 'outro'
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
    settings: {
      aspectId,
      timeShift: { ...NO_SHIFT },
      timeScale: { ...AUTO_TIME_SCALE },
    },
    elements: template ? structuredClone(template.elements) : elements,
    guides: template ? structuredClone(template.guides) : guides,
    lut: template
      ? structuredClone(template.lut)
      : { selected: 'none', customName: null, customText: null, intensity: 1 },
    lutStack: template ? structuredClone(template.lutStack) : [],
    outputTransform: template ? template.outputTransform : 'none',
    theme: template ? structuredClone(template.theme) : null,
    scenes: template ? structuredClone(template.scenes ?? []) : [],
    outro: template ? structuredClone(template.outro ?? null) : null,
    exportPrefs: template
      ? structuredClone(template.exportPrefs)
      : { fileName: null, variants: defaultVariants() },
    media: { dirHandle: null, files: [], activeId: null, trims: {} },
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
 * which is the only cadence an export could produce before it existed;
 * v7 → v8 adds the per-clip trims, empty, so every clip reopens at its full
 * length; v8 → v9 adds the safe zone's quarter-turn mode, on 'auto'; v9 → v10
 * adds the cadence correction, on `auto`.
 *
 * v10 is the one migration that deliberately changes what a reopened project
 * shows: a slow-motion clip used to report a fraction of its true ground speed,
 * and pinning old projects to `manual: 1` would preserve that as if it were a
 * choice. It is a measurement being corrected, it is stated in the Info tab, and
 * `manual` is one click away; v10 → v11 gives every stored variant an explicit
 * speed of 1, which is the only speed an export could deliver before it
 * existed; v11 → v12 adds the scene list, empty — no project could have an
 * intro before it existed, and an empty list draws exactly nothing; v12 → v13
 * adds the outro card, null, for the same reason.
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
  if (migrated.version < 8) {
    // No trim was possible before v8: every clip runs full length.
    migrated.media = { ...migrated.media, trims: migrated.media?.trims ?? {} };
  }
  if (migrated.version < 9) {
    // 'auto', not the pre-v9 'upright'. The usual rule — a reopened project
    // must look exactly as it was closed — guards RENDERED output; guides are
    // editor-only chrome that never reaches a pixel of the export, and landing
    // old projects on 'upright' would hide the quarter-turn from every project
    // that predates it. One click on Rotate pins it back.
    migrated.guides = {
      ...(migrated.guides ?? DEFAULT_GUIDES),
      safeZoneOrientation: migrated.guides?.safeZoneOrientation ?? 'auto',
    };
  }
  if (migrated.version < 10) {
    // 'auto', not 'manual: 1': an old project's speeds were not a choice, they
    // were a clip's cadence going unmeasured. See the note above.
    migrated.settings = {
      ...migrated.settings,
      timeScale: migrated.settings?.timeScale ?? { ...AUTO_TIME_SCALE },
    };
  }
  if (migrated.version < 11) {
    migrated.exportPrefs = {
      ...migrated.exportPrefs,
      variants: (migrated.exportPrefs?.variants ?? defaultVariants()).map((v) => ({
        ...v,
        speed: v.speed ?? 1,
      })),
    };
  }
  if (migrated.version < 12) {
    migrated.scenes = migrated.scenes ?? [];
  }
  if (migrated.version < 13) {
    // Null, not a default card: no project could end on an outro before one
    // existed, and null draws (and appends) exactly nothing.
    migrated.outro = migrated.outro ?? null;
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
