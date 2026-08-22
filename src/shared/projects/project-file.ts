/**
 * The project file: a studio project's PORTABLE half on disk, as JSON.
 *
 * It is the same split the document model already makes (project-types.ts):
 * everything reusable with any media travels — composition settings, overlay
 * elements, guides, the grade stack (custom `.cube` text inlined, so a shared
 * look grades identically), the title theme, the export matrix. Nothing bound
 * to this machine does: no directory handle, no media list, no thumbnail, no
 * document id. A project file is a template you can mail, not a backup of a
 * folder.
 *
 * `version` is the ProjectDoc version the file was written at, so an older
 * file replays the same migration chain a stored document does. A file from a
 * NEWER version is refused rather than half-read — silently dropping fields we
 * do not understand would quietly damage someone's project.
 *
 * Pure and DOM-free: parsing, validating and applying are testable; picking
 * and downloading files stay in the UI.
 */

import type { OverlayElement } from '../overlay/overlay-types';
import type { GuidesState } from '../overlay/guides';
import { DEFAULT_GUIDES } from '../overlay/guides';
import type { StyleTheme } from '../overlay/title-styles';
import type { Scene } from '../overlay/scenes';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import type { OutputTransform } from '../lut/transfer';
import { NO_SHIFT } from '../telemetry/time-format';
import { defaultVariants } from './export-variants';
import {
  PROJECT_DOC_VERSION,
  migrateProjectDoc,
  type ExportPrefs,
  type ProjectDoc,
  type ProjectSettings,
} from './project-types';

/** Marks the file as ours; a stray `.json` is rejected on it. */
export const PROJECT_FILE_KIND = 'atelier/studio-project';

/** Double extension: recognisable at a glance, still a plain `.json`. */
export const PROJECT_FILE_EXTENSION = '.atelier.json';

/** What the file picker accepts. */
export const PROJECT_FILE_ACCEPT = '.json,application/json';

/** The portable half of a project — what a project file carries. */
export interface ProjectPortable {
  settings: ProjectSettings;
  elements: OverlayElement[];
  guides: GuidesState;
  lutStack: SavedLutLayer[];
  outputTransform: OutputTransform;
  theme: StyleTheme | null;
  scenes: Scene[];
  exportPrefs: ExportPrefs;
}

export interface ProjectFile extends ProjectPortable {
  kind: typeof PROJECT_FILE_KIND;
  /** ProjectDoc version this was written at — drives the migration on read. */
  version: number;
  /** The project's name when it was exported; informative, never binding. */
  name: string;
  /** ISO timestamp, for the human reading the file. */
  exportedAt: string;
}

export type ParseResult =
  | { ok: true; file: ProjectFile }
  | { ok: false; error: string };

/** Build the file from a project document (or from the editor's live state). */
export function toProjectFile(
  source: ProjectPortable & { name: string },
  exportedAt: number = Date.now(),
): ProjectFile {
  // The cadence correction stays home: it is measured against ONE clip's
  // telemetry (and carries that clip's id), so travelling with a template it
  // could only misapply — a 4× override silently quadrupling another clip's
  // speeds. `parseProjectFile` drops it on the way in; not writing it keeps the
  // file honest about what it can restore.
  const portableSettings = structuredClone(source.settings);
  delete portableSettings.timeScale;
  return {
    kind: PROJECT_FILE_KIND,
    version: PROJECT_DOC_VERSION,
    name: source.name,
    exportedAt: new Date(exportedAt).toISOString(),
    settings: portableSettings,
    elements: structuredClone(source.elements),
    guides: structuredClone(source.guides),
    lutStack: structuredClone(source.lutStack),
    outputTransform: source.outputTransform,
    theme: structuredClone(source.theme),
    scenes: structuredClone(source.scenes ?? []),
    exportPrefs: structuredClone(source.exportPrefs),
  };
}

/** Indented on purpose: the file is meant to be readable and diffable. */
export function serializeProjectFile(file: ProjectFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** `Vol du soir` → `vol-du-soir.atelier.json`. */
export function projectFileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'project'}${PROJECT_FILE_EXTENSION}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a file's text into a project file, or explain why it isn't one. The
 * input comes from the user's disk and may be anything at all: this never
 * throws, and every rejection says something a human can act on.
 */
export function parseProjectFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: 'That file is not an Atelier project file.' };
  }
  if (raw.kind !== PROJECT_FILE_KIND) {
    return {
      ok: false,
      error: 'That file is not an Atelier project file (wrong or missing kind).',
    };
  }
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > PROJECT_DOC_VERSION) {
    return {
      ok: false,
      error:
        `This file was written by a newer version of Atelier (format ${version}, ` +
        `this one reads up to ${PROJECT_DOC_VERSION}). Update the app first.`,
    };
  }
  if (!Array.isArray(raw.elements)) {
    return { ok: false, error: 'The file has no overlay elements list.' };
  }
  if (!isRecord(raw.settings) || typeof raw.settings.aspectId !== 'string') {
    return { ok: false, error: 'The file has no project format.' };
  }

  // Shape is sound; anything optional that a past version did not write is
  // filled with the same default a migrated document gets.
  const portable: ProjectPortable = {
    settings: {
      aspectId: raw.settings.aspectId,
      timeShift: isRecord(raw.settings.timeShift)
        ? {
            minutes: Number(raw.settings.timeShift.minutes) || 0,
            days: Number(raw.settings.timeShift.days) || 0,
          }
        : { ...NO_SHIFT },
    },
    elements: raw.elements as OverlayElement[],
    guides: isRecord(raw.guides)
      ? (raw.guides as unknown as GuidesState)
      : structuredClone(DEFAULT_GUIDES),
    lutStack: Array.isArray(raw.lutStack) ? (raw.lutStack as SavedLutLayer[]) : [],
    outputTransform: (raw.outputTransform as OutputTransform) ?? 'none',
    theme: isRecord(raw.theme) ? (raw.theme as unknown as StyleTheme) : null,
    scenes: Array.isArray(raw.scenes) ? (raw.scenes as Scene[]) : [],
    exportPrefs:
      isRecord(raw.exportPrefs) && Array.isArray(raw.exportPrefs.variants)
        ? {
            fileName:
              typeof raw.exportPrefs.fileName === 'string'
                ? raw.exportPrefs.fileName
                : null,
            variants: raw.exportPrefs.variants as ExportPrefs['variants'],
          }
        : { fileName: null, variants: defaultVariants() },
  };

  // Replay the document migrations: an older file must land on the current
  // shape exactly as an older stored project does.
  const migrated = migrateProjectDoc({
    ...(portable as unknown as ProjectDoc),
    version,
  } as ProjectDoc);

  return {
    ok: true,
    file: {
      kind: PROJECT_FILE_KIND,
      version: PROJECT_DOC_VERSION,
      name: typeof raw.name === 'string' ? raw.name : '',
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      settings: migrated.settings,
      elements: migrated.elements,
      guides: migrated.guides,
      lutStack: migrated.lutStack,
      outputTransform: migrated.outputTransform,
      theme: migrated.theme,
      scenes: migrated.scenes,
      exportPrefs: migrated.exportPrefs,
    },
  };
}

/**
 * Replace a document's portable half with the file's. The bound half — id,
 * media folder, thumbnail, creation date — and the project's own NAME are
 * kept: importing settings into "Vol du soir" must not rename it after
 * whoever exported the file.
 */
export function applyProjectFile(
  doc: ProjectDoc,
  file: ProjectFile,
  now: number = Date.now(),
): ProjectDoc {
  return {
    ...doc,
    updatedAt: now,
    settings: structuredClone(file.settings),
    elements: structuredClone(file.elements),
    guides: structuredClone(file.guides),
    lutStack: structuredClone(file.lutStack),
    outputTransform: file.outputTransform,
    theme: structuredClone(file.theme),
    exportPrefs: structuredClone(file.exportPrefs),
  };
}
