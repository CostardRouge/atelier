/**
 * The Studio's HOUSE STYLE — the look a brand-new project starts from, once
 * the maintainer has saved one from a project he likes. The twin of Trips'
 * (`shared/roadtrip/house-style.ts`), which explains the file, the dev-server
 * writer and why a committed file rather than a browser store.
 *
 * It is the project's PORTABLE half (`project-file.ts`) minus what belongs to
 * one project or one clip:
 *
 * - no `settings`: the format is chosen in the creation modal, and the
 *   capture-time shift and the cadence are facts about one clip's footage;
 * - no export file name: a base name is one project's;
 * - nothing Trips SENT into the project — its hook scene and elements, and a
 *   closing card it put in the outro slot (`hook-scene.ts`): a day's badge
 *   from one journey is nobody's default. The author's own intro and outro
 *   stay;
 * - no UPLOADED look: its whole `.cube` rides in the layer, and the way to
 *   ship a look is `public/luts/`. (A project FILE inlines it on purpose — a
 *   template you mail must grade identically; a bundle must stay small.)
 *
 * A new project with no template wears it; picking a template, importing a
 * file, duplicating, or a project Trips creates around a clip never does.
 *
 * Pure and DOM-free. The committed file is read by `house-style-bundle.ts`.
 */

import { isUploadedLook } from '../lut/saved-grade';
import { HOOK_SCENE_ID, isHookElement, isRoadtripOutro } from '../roadtrip/hook-scene';
import {
  PROJECT_FILE_KIND,
  parseProjectFile,
  type ProjectPortable,
} from './project-file';
import { PROJECT_DOC_VERSION, type ProjectDoc } from './project-types';

/** Tells the house style apart from any other JSON in the repository. */
export const PROJECT_HOUSE_STYLE_KIND = 'atelier.project-house-style';

/** Where the dev server writes it, relative to the repository — said in the UI. */
export const PROJECT_HOUSE_STYLE_PATH = 'src/shared/projects/house-style.json';

/** The portable half without the settings — the only fields a house style carries. */
export type ProjectHouseStyle = Omit<ProjectPortable, 'settings'>;

export interface ProjectHouseStyleFile {
  kind: typeof PROJECT_HOUSE_STYLE_KIND;
  /** The `PROJECT_DOC_VERSION` it was written at: what lets a later build migrate it. */
  version: number;
  style: ProjectHouseStyle;
}

export interface ProjectHouseStyleSnapshot {
  file: ProjectHouseStyleFile;
  /** The uploaded looks the grade had and the house style leaves behind, by name. */
  uploadedLooks: string[];
  /** True when a hook or a closing card sent from Trips was left behind. */
  leftTrips: boolean;
}

/** A copy of the style's own fields, nothing else. */
function pickStyle(source: ProjectHouseStyle): ProjectHouseStyle {
  return structuredClone({
    elements: source.elements,
    guides: source.guides,
    lutStack: source.lutStack,
    outputTransform: source.outputTransform,
    // The texture travels with the look: a house style IS the grade a new
    // project starts from, and a stock without its grain is half a stock.
    lutFilm: source.lutFilm ?? null,
    theme: source.theme,
    scenes: source.scenes,
    outro: source.outro,
    exportPrefs: source.exportPrefs,
  });
}

/** The project's look as a file to commit, and what it had to leave behind. */
export function projectHouseStyleFrom(project: ProjectHouseStyle): ProjectHouseStyleSnapshot {
  const style = pickStyle(project);
  const elements = style.elements.filter((el) => !isHookElement(el));
  const scenes = style.scenes.filter((scene) => scene.id !== HOOK_SCENE_ID);
  const outro = isRoadtripOutro(style.outro) ? null : style.outro;
  const leftTrips =
    elements.length !== style.elements.length ||
    scenes.length !== style.scenes.length ||
    outro !== style.outro;
  return {
    file: {
      kind: PROJECT_HOUSE_STYLE_KIND,
      version: PROJECT_DOC_VERSION,
      style: {
        ...style,
        elements,
        scenes,
        outro,
        // An uploaded cube's lattice cannot be committed; a film stock's
        // settings can, and are exactly what a house style is for.
        lutStack: style.lutStack.filter((layer) => !isUploadedLook(layer)),
        exportPrefs: { ...style.exportPrefs, fileName: null },
      },
    },
    uploadedLooks: style.lutStack.filter(isUploadedLook).map((layer) => layer.name),
    leftTrips,
  };
}

export function serializeProjectHouseStyle(file: ProjectHouseStyleFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The house style a parsed file holds, on the CURRENT shape — or null when it
 * is not one, or was written by a newer build. It is read as the project file
 * it nearly is (`parseProjectFile`), so an older one replays the same
 * migrations a stored project does and a block it lacks gets the same default.
 */
export function readProjectHouseStyle(raw: unknown): ProjectHouseStyle | null {
  if (!isRecord(raw) || raw.kind !== PROJECT_HOUSE_STYLE_KIND) return null;
  const { style, version } = raw;
  if (!isRecord(style)) return null;
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;
  if (version < 1 || version > PROJECT_DOC_VERSION) return null;
  const parsed = parseProjectFile(
    JSON.stringify({
      ...style,
      kind: PROJECT_FILE_KIND,
      version,
      name: '',
      exportedAt: '',
      // Any format will do: the settings are not part of a house style and
      // are dropped again below.
      settings: { aspectId: '9:16' },
    }),
  );
  if (!parsed.ok) return null;
  return pickStyle(parsed.file);
}

/** A new project dressed in the house style; `null` leaves it on the factory look. */
export function applyProjectHouseStyle(
  doc: ProjectDoc,
  style: ProjectHouseStyle | null,
): ProjectDoc {
  return style ? { ...doc, ...pickStyle(style) } : doc;
}
