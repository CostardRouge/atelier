/**
 * A grade as a DOCUMENT stores it: its shape, its identity, and reading one
 * back out of untrusted JSON.
 *
 * Deliberately apart from `restore-grade.ts`, which parses the cubes a bake
 * needs and therefore reaches for `virtual:luts` — a Vite module that does not
 * exist in a node test run. Everything here is arithmetic over stored values,
 * so a document module can migrate a grade without dragging the built-in
 * manifest into every unit test that touches a trip.
 *
 * Pure and DOM-free.
 */

import { OUTPUT_TRANSFORM_OPTIONS, type OutputTransform } from './transfer';
import type { SavedLutLayer } from './use-lut-stack';

/**
 * A grade exactly as a document stores it — the Studio's `lutStack` +
 * `outputTransform`, and `TripGrade`'s own two fields. Structural on purpose:
 * this module grades what it is handed and never learns whose document it
 * came from.
 */
export interface SavedGrade {
  layers: SavedLutLayer[];
  output: OutputTransform;
}

/** The `source` of a film layer — `shared/film/film-layer.ts` owns the layer, this module only recognises it. */
const FILM_SOURCE = 'film';

/**
 * A stable key for a stored grade — what makes "these two pictures wear the
 * same look" a string compare, and what a bake cache is keyed on.
 *
 * It reads each layer's IDENTITY (id, source, strength, on/off) and the output
 * transform, never an uploaded layer's `.cube` TEXT: an id is minted when the
 * look is uploaded and its text never changes after, so the id says everything
 * the text would — and stringifying a megabyte of lattice once per picture per
 * render is how a deck of five makes a strength slider stutter.
 *
 * A FILM layer is the one exception, and the rationale is why: its text is a
 * few dozen numbers that change on every dial move under one id, so the id
 * says nothing about them — left out, two stocks under one id would share a
 * baked cube and a deck would show one picture's film on another.
 */
export function gradeKey(grade: SavedGrade | null): string {
  if (!grade) return '-';
  const layers = grade.layers.map(
    (l) =>
      `${l.id}:${l.source}:${l.intensity}:${l.enabled ? 1 : 0}` +
      (l.source === FILM_SOURCE ? `:${l.customText ?? ''}` : ''),
  );
  return [grade.output, ...layers].join('|');
}

/**
 * True for a look UPLOADED from a `.cube` — text a house style cannot carry
 * (its whole lattice would be committed) and a file format inlines. A film
 * layer carries text too, but it is settings, not a cube, and it is exactly
 * the kind of look a house style is for.
 */
export function isUploadedLook(layer: Pick<SavedLutLayer, 'source' | 'customText'>): boolean {
  return layer.customText !== null && layer.source !== FILM_SOURCE;
}

/**
 * A grade read defensively out of a stored document or an imported file:
 * junk, or nothing at all, is NO grade (`null`) rather than a shape a bake
 * would trip over. An EMPTY grade is not junk — `{ layers: [], output:
 * 'none' }` is a real departure, the picture that wears no look while the
 * trip wears one — so it comes back as itself.
 */
export function gradeOrNull(value: unknown): SavedGrade | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as { layers?: unknown; output?: unknown };
  if (!Array.isArray(raw.layers)) return null;
  const output = OUTPUT_TRANSFORM_OPTIONS.some((o) => o.id === raw.output)
    ? (raw.output as OutputTransform)
    : 'none';
  return { layers: raw.layers.filter(isSavedLayer).map(readLayer), output };
}

function isSavedLayer(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as { id?: unknown; source?: unknown };
  return typeof raw.id === 'string' && typeof raw.source === 'string';
}

function readLayer(raw: Record<string, unknown>): SavedLutLayer {
  return {
    id: String(raw.id),
    source: String(raw.source),
    name: typeof raw.name === 'string' ? raw.name : '',
    customText: typeof raw.customText === 'string' ? raw.customText : null,
    intensity:
      typeof raw.intensity === 'number' && Number.isFinite(raw.intensity) ? raw.intensity : 1,
    // Absent means ON: a layer nobody switched off is a layer that grades.
    enabled: raw.enabled !== false,
  };
}
