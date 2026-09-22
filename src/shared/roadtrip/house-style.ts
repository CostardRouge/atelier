/**
 * The HOUSE STYLE — the look a brand-new trip starts from, once the maintainer
 * has saved one from a trip he likes.
 *
 * The factory look is a handful of constants, each defined where its thing is
 * (`DEFAULT_BADGE_WORDS`, `DEFAULT_CTA`, `defaultCarSpec`, the `neutral`
 * theme…). A house style replaces them for a NEW trip only, as ONE committed
 * file, `house-style.json` beside this module: the dev server writes it
 * (`vite.config.ts`), saving is a diff to read and commit, and the deployed
 * site ships exactly what was committed. An existing trip never changes — a
 * look is adopted, never imposed — and a backup restores its own look
 * (`trip-file.ts` keeps the factory base).
 *
 * It carries the trip's VOICE and nothing that tells one journey: the words,
 * the title style, the closing card, the look each kind of piece starts from,
 * the grade and the car. Never the name, the dates, the legs, the pieces, the
 * cover or the develop presets (numbers applied to one picture at a time, not
 * a look a trip wears). Inside what it carries, two things stay behind:
 *
 * - what an opener was given for ONE piece (`HookVariant.contentKeys`: the
 *   pictures a sweep flashes, an itinerary's stops) goes back to the variant's
 *   default — a picture ref from one trip is nothing in the next;
 * - an UPLOADED look is dropped from the grade: its whole `.cube` rides in
 *   the layer, and the way to ship a look is `public/luts/`.
 *
 * Pure and DOM-free. The committed file is read by `house-style-bundle.ts`.
 */

import { isUploadedLook } from '../lut/saved-grade';
import { hookVariantById } from './hooks/registry';
import type { HookLayer } from './hooks/hook-variant';
import {
  TRIP_DOC_VERSION,
  createTripDoc,
  migrateTripDoc,
  type HookDefaults,
  type HookDefaultsByKind,
  type TripDoc,
  type TripGrade,
} from './trip-types';

/** Tells the house style apart from any other JSON in the repository. */
export const HOUSE_STYLE_KIND = 'atelier.trip-house-style';

/** Where the dev server writes it, relative to the repository — said in the UI. */
export const HOUSE_STYLE_PATH = 'src/shared/roadtrip/house-style.json';

/** The fields of `TripDoc` a house style carries — and the only ones. */
export type TripHouseStyle = Pick<
  TripDoc,
  'badgeWords' | 'theme' | 'cta' | 'hookDefaults' | 'grade' | 'car'
>;

export interface HouseStyleFile {
  kind: typeof HOUSE_STYLE_KIND;
  /** The `TRIP_DOC_VERSION` it was written at: what lets a later build migrate it. */
  version: number;
  style: TripHouseStyle;
}

export interface HouseStyleSnapshot {
  file: HouseStyleFile;
  /** The uploaded looks the grade had and the house style leaves behind, by name. */
  uploadedLooks: string[];
}

/** A copy of the style's own fields out of a document, nothing else. */
function pickStyle(doc: TripHouseStyle): TripHouseStyle {
  return structuredClone({
    badgeWords: doc.badgeWords,
    theme: doc.theme,
    cta: doc.cta,
    hookDefaults: doc.hookDefaults,
    grade: doc.grade,
    car: doc.car,
  });
}

/** An opener with what it was given for one piece put back to the variant's default. */
function forgetContent(layer: HookLayer): HookLayer {
  const variant = hookVariantById(layer.id);
  // An id this build does not know cannot be read, so it cannot be cleaned
  // either — and a save only ever runs on a build that drew it.
  if (!variant?.contentKeys?.length) return layer;
  const options = { ...layer.options };
  for (const key of variant.contentKeys) {
    if (key in variant.defaults) options[key] = structuredClone(variant.defaults[key]);
    else delete options[key];
  }
  return { ...layer, options };
}

function styleDefaults(defaults: HookDefaults): HookDefaults {
  return {
    ...defaults,
    // `defaultPostBadge` mints a fresh id per shade on every use, so the stored
    // ones only need to be stable: a re-save of the same trip is then an empty
    // diff rather than a line per shade.
    shades: defaults.shades.map((shade, i) => ({ ...shade, id: `shade-${i + 1}` })),
    hook: defaults.hook.map(forgetContent),
  };
}

/** The trip's look as a file to commit, and what it had to leave behind. */
export function houseStyleFrom(trip: TripDoc): HouseStyleSnapshot {
  const style = pickStyle(trip);
  const hookDefaults: HookDefaultsByKind = {};
  for (const [kind, defaults] of Object.entries(style.hookDefaults)) {
    if (defaults) hookDefaults[kind as keyof HookDefaultsByKind] = styleDefaults(defaults);
  }
  // An uploaded cube's whole lattice cannot be committed; a film stock's
  // settings can, and are exactly what a house style is for.
  const uploaded = style.grade.layers.filter(isUploadedLook);
  const grade: TripGrade = {
    ...style.grade,
    layers: style.grade.layers.filter((layer) => !isUploadedLook(layer)),
  };
  return {
    file: {
      kind: HOUSE_STYLE_KIND,
      version: TRIP_DOC_VERSION,
      style: { ...style, hookDefaults, grade },
    },
    uploadedLooks: uploaded.map((layer) => layer.name),
  };
}

export function serializeHouseStyle(file: HouseStyleFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The house style a parsed file holds, on the CURRENT shape — or null when it
 * is not one, or was written by a newer build (refused rather than half-read,
 * like a trip file). An older file is replayed through `migrateTripDoc` inside
 * a blank trip, so it lands exactly where a stored trip of that version would,
 * and a block the file lacks keeps the factory's.
 */
export function readHouseStyle(raw: unknown): TripHouseStyle | null {
  if (!isRecord(raw) || raw.kind !== HOUSE_STYLE_KIND) return null;
  const { style: stored, version } = raw;
  if (!isRecord(stored)) return null;
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;
  if (version < 1 || version > TRIP_DOC_VERSION) return null;
  const blank = createTripDoc('', '2000-01-01', '2000-01-01');
  // `in`, not `??`: a stored `theme: null` is a choice, not a missing block.
  const given = Object.fromEntries(
    Object.entries(pickStyle(blank)).map(([key, fallback]) => [
      key,
      key in stored ? stored[key] : fallback,
    ]),
  );
  return pickStyle(migrateTripDoc({ ...blank, ...given, version } as TripDoc));
}

/** A new trip dressed in the house style; `null` leaves it on the factory look. */
export function applyHouseStyle(doc: TripDoc, style: TripHouseStyle | null): TripDoc {
  return style ? { ...doc, ...pickStyle(style) } : doc;
}
