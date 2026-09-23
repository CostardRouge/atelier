/**
 * WHAT leaves in a delivered file's metadata, in groups a person can reason
 * about (`docs/lightroom-gaps.md` §9, M3) — never a list of forty tags.
 *
 * One choice per ROLL (`RollExport.metadata`): a roll is a delivery, and "this
 * set goes online, no position" is said of the delivery, not of each frame.
 * Three presets name the usual answers; any other combination reads Custom.
 *
 * **The cost of leaving something out is said, not hidden.** A JPEG's own
 * EXIF block is COPIED whole whenever it can be (`stamp-exif.ts`), which is
 * what keeps the maker notes, the serial numbers and every tag no struct here
 * models. Dropping any CAPTURE group — the camera, the exposure, the time, the
 * position — or the maker notes themselves means REBUILDING the block from its
 * fields instead, and whatever the fields do not name stays behind. So
 * `keepsWholeBlock` is the one question the panel asks aloud.
 *
 * The signature is not a group: it is always written (`delivery-meta.ts`).
 *
 * Pure and DOM-free.
 */

import type { ExifData } from './exif-parser';

export type MetaGroup = 'camera' | 'exposure' | 'time' | 'position' | 'makerNotes' | 'words' | 'rights';

export type MetaChoice = Record<MetaGroup, boolean>;

/** The groups in the order a panel lists them, with what each one holds. */
export const META_GROUPS: readonly { id: MetaGroup; label: string; hint: string }[] = [
  { id: 'camera', label: 'Camera and lens', hint: 'make, model, lens' },
  { id: 'exposure', label: 'Exposure', hint: 'shutter, aperture, ISO, focal length, compensation, flash' },
  { id: 'time', label: 'Capture time', hint: 'the moment it was taken' },
  { id: 'position', label: 'GPS position', hint: 'latitude, longitude, altitude' },
  { id: 'makerNotes', label: 'Maker notes and serials', hint: 'everything else the camera wrote — kept only by copying its block whole' },
  { id: 'words', label: 'Title and caption', hint: 'this picture’s own words' },
  { id: 'rights', label: 'Creator and copyright', hint: 'your name and your line' },
];

export const ALL_META: Readonly<MetaChoice> = Object.freeze({
  camera: true,
  exposure: true,
  time: true,
  position: true,
  makerNotes: true,
  words: true,
  rights: true,
});

export type MetaPresetId = 'all' | 'share' | 'minimal';

/**
 * The three usual answers. *All* is the default — the maintainer finds a
 * photograph by its position, so the GPS leaves unless asked otherwise.
 * *Share online* keeps what a viewer enjoys and drops what locates or
 * identifies: the position and the serials. *Minimal* is the rights alone.
 */
export const META_PRESETS: readonly { id: MetaPresetId; label: string; choice: Readonly<MetaChoice> }[] = [
  { id: 'all', label: 'All', choice: ALL_META },
  { id: 'share', label: 'Share online', choice: Object.freeze({ ...ALL_META, position: false, makerNotes: false }) },
  {
    id: 'minimal',
    label: 'Minimal',
    choice: Object.freeze({
      camera: false,
      exposure: false,
      time: false,
      position: false,
      makerNotes: false,
      words: false,
      rights: true,
    }),
  },
];

/** A stored choice: every group it does not name is kept, so an older roll reads as All. */
export function readMetaChoice(raw: unknown): MetaChoice {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...ALL_META };
  for (const { id } of META_GROUPS) if (r[id] === false) out[id] = false;
  return out;
}

/** Which preset a choice IS, or null for a combination of its own. */
export function presetOf(choice: MetaChoice): MetaPresetId | null {
  const match = META_PRESETS.find((p) => META_GROUPS.every(({ id }) => p.choice[id] === choice[id]));
  return match?.id ?? null;
}

/**
 * Whether the camera's own block can travel whole — every capture group and
 * the maker notes kept. The rights and the words are written over a copy
 * either way, so they never force a rebuild.
 */
export function keepsWholeBlock(choice: MetaChoice): boolean {
  return choice.camera && choice.exposure && choice.time && choice.position && choice.makerNotes;
}

/** Whether any of the capture's own facts leave — the run says so when none were known. */
export function keepsCapture(choice: MetaChoice): boolean {
  return choice.camera || choice.exposure || choice.time || choice.position;
}

const GROUP_FIELDS: Record<'camera' | 'exposure' | 'time' | 'position', readonly (keyof ExifData)[]> = {
  camera: ['make', 'model', 'lensMake', 'lensModel'],
  exposure: [
    'iso',
    'exposureTime',
    'fNumber',
    'focalLength',
    'focalLength35',
    'exposureBias',
    'exposureProgram',
    'meteringMode',
    'whiteBalance',
    'flash',
  ],
  time: ['dateTimeOriginal'],
  position: ['gps', 'gpsAltitude', 'relativeAltitude'],
};

/**
 * `exif` without the capture groups the choice leaves out. The author's
 * tags — artist, copyright, description — are the writer's to decide
 * (`stamp-exif.ts`), and what describes the file itself (its software, its
 * size, its orientation) is never the choice's.
 */
export function filterExif(exif: ExifData, choice: MetaChoice): ExifData {
  const out: ExifData = { ...exif };
  for (const group of ['camera', 'exposure', 'time', 'position'] as const) {
    if (choice[group]) continue;
    for (const key of GROUP_FIELDS[group]) delete out[key];
  }
  return out;
}
