/**
 * The trip file: a whole road trip on disk, as JSON.
 *
 * This is NOT the studio's `.atelier.json`, and the difference is deliberate.
 * A project file carries a project's *portable half* — a template you can mail,
 * with nothing bound to one folder. A trip has no such split: its stages, its
 * days told, the words its badges say and the look they wear ARE the trip.
 * So this is a **backup and a transfer**, and it carries everything except
 * what is meaningless outside this browser:
 *
 * - `id` — a fresh one is minted on import, so a file can be read twice
 *   without the second read overwriting the first.
 * - `TripPost.projectId` — it addresses a Studio project in *this* browser's
 *   store. Carried across, it would dangle and offer to open nothing.
 * - the post thumbnails, which live in their own IndexedDB store and are
 *   re-baked from the preview anyway.
 *
 * Media refs DO travel. Since they carry a content hash (`SavedMediaRef.hash`),
 * a trip opened on another machine can find its pictures again in a folder
 * whose files have been renamed or re-graded — which is the whole point of
 * having one identity on both sides (`docs/winnow-bridge.md` §4.2), and what
 * makes this the way a trip crosses from one source to another.
 *
 * `version` is the TripDoc version the file was written at, so an older file
 * replays the same migration chain a stored document does. A file from a NEWER
 * version is refused rather than half-read.
 *
 * Pure and DOM-free: parsing, validating and applying are testable; picking
 * and downloading files stay in the UI.
 */

import { isIsoDate } from './trip-days';
import {
  TRIP_DOC_VERSION,
  createTripDoc,
  migrateTripDoc,
  type TripDoc,
  type TripPost,
} from './trip-types';

/** Marks the file as ours; a stray `.json` is rejected on it. */
export const TRIP_FILE_KIND = 'atelier/road-trip';

/** Double extension: recognisable at a glance, still a plain `.json`. */
export const TRIP_FILE_EXTENSION = '.roadtrip.json';

/** What the file picker accepts. */
export const TRIP_FILE_ACCEPT = '.json,application/json';

/** Everything a trip file carries — the document minus what is machine-bound. */
export type TripPortable = Omit<TripDoc, 'version' | 'id' | 'createdAt' | 'updatedAt'>;

export interface TripFile extends TripPortable {
  kind: typeof TRIP_FILE_KIND;
  /** TripDoc version this was written at — drives the migration on read. */
  version: number;
  /** ISO timestamp, for the human reading the file. */
  exportedAt: string;
}

export type ParseResult = { ok: true; file: TripFile } | { ok: false; error: string };

/** Strip what only means something in the browser that wrote it. */
function portablePost(post: TripPost): TripPost {
  return { ...structuredClone(post), projectId: null };
}

export function toTripFile(trip: TripDoc, exportedAt: number = Date.now()): TripFile {
  return {
    kind: TRIP_FILE_KIND,
    version: TRIP_DOC_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    stages: structuredClone(trip.stages),
    posts: trip.posts.map(portablePost),
    badgeWords: structuredClone(trip.badgeWords),
    theme: structuredClone(trip.theme),
    cta: structuredClone(trip.cta),
    hookDefaults: structuredClone(trip.hookDefaults),
    // The grade travels: a custom .cube rides as text inside its layer, so a
    // trip opened elsewhere renders its pictures with the same look.
    grade: structuredClone(trip.grade),
  };
}

/** Indented on purpose: the file is meant to be readable and diffable. */
export function serializeTripFile(file: TripFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** `Australie` → `australie.roadtrip.json`. */
export function tripFileName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'trip'}${TRIP_FILE_EXTENSION}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a file's text into a trip file, or explain why it isn't one. The input
 * comes from the user's disk and may be anything at all: this never throws, and
 * every rejection says something a human can act on.
 */
export function parseTripFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: 'That file is not an Atelier road-trip file.' };
  }
  if (raw.kind !== TRIP_FILE_KIND) {
    return {
      ok: false,
      error: 'That file is not an Atelier road-trip file (wrong or missing kind).',
    };
  }
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > TRIP_DOC_VERSION) {
    return {
      ok: false,
      error:
        `This file was written by a newer version of Atelier (format ${version}, ` +
        `this one reads up to ${TRIP_DOC_VERSION}). Update the app first.`,
    };
  }
  // The two dates are the trip's spine: every day, every stage span and every
  // post's place is derived from them, so a file without them is not a trip.
  const startDate = raw.startDate;
  const endDate = raw.endDate;
  if (
    typeof startDate !== 'string' ||
    typeof endDate !== 'string' ||
    !isIsoDate(startDate) ||
    !isIsoDate(endDate)
  ) {
    return { ok: false, error: 'The file has no trip dates.' };
  }

  // Shape is sound. Replay the document migrations on a document built from
  // the file, so an older file lands on the current shape exactly as an older
  // stored trip does — and anything a past version did not write is filled by
  // the same defaults `createTripDoc` uses.
  const base = createTripDoc(
    typeof raw.name === 'string' ? raw.name : '',
    typeof raw.destination === 'string' ? raw.destination : '',
    startDate,
    endDate,
  );
  const migrated = migrateTripDoc({
    ...base,
    version,
    startDate,
    endDate,
    stages: Array.isArray(raw.stages) ? (raw.stages as TripDoc['stages']) : base.stages,
    posts: Array.isArray(raw.posts) ? (raw.posts as TripPost[]) : base.posts,
    badgeWords: isRecord(raw.badgeWords)
      ? (raw.badgeWords as unknown as TripDoc['badgeWords'])
      : base.badgeWords,
    theme: isRecord(raw.theme) ? (raw.theme as unknown as TripDoc['theme']) : base.theme,
    cta: isRecord(raw.cta) ? (raw.cta as unknown as TripDoc['cta']) : base.cta,
    hookDefaults: isRecord(raw.hookDefaults)
      ? (raw.hookDefaults as unknown as TripDoc['hookDefaults'])
      : base.hookDefaults,
    grade: isRecord(raw.grade) ? (raw.grade as unknown as TripDoc['grade']) : base.grade,
  });

  return {
    ok: true,
    file: {
      kind: TRIP_FILE_KIND,
      version: TRIP_DOC_VERSION,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      name: migrated.name,
      destination: migrated.destination,
      startDate: migrated.startDate,
      endDate: migrated.endDate,
      stages: migrated.stages,
      // Belt and braces: a hand-edited file could carry a projectId that means
      // nothing here, and a dangling "Open in Studio" is worse than none.
      posts: migrated.posts.map(portablePost),
      badgeWords: migrated.badgeWords,
      theme: migrated.theme,
      cta: migrated.cta,
      hookDefaults: migrated.hookDefaults,
      grade: migrated.grade,
    },
  };
}

/**
 * A brand-new trip document from a file — the import path. A fresh `id` and
 * fresh timestamps, so importing the same file twice gives two trips instead
 * of silently overwriting one.
 */
export function tripDocFromFile(file: TripFile, now: number = Date.now()): TripDoc {
  const doc = createTripDoc(file.name, file.destination, file.startDate, file.endDate);
  return {
    ...doc,
    createdAt: now,
    updatedAt: now,
    stages: structuredClone(file.stages),
    posts: file.posts.map(portablePost),
    badgeWords: structuredClone(file.badgeWords),
    theme: structuredClone(file.theme),
    cta: structuredClone(file.cta),
    hookDefaults: structuredClone(file.hookDefaults),
    grade: structuredClone(file.grade),
  };
}
