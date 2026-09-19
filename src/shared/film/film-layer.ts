/**
 * A film stock as a LAYER of the look stack — `source: 'film'`, its settings
 * in the layer's `customText` as JSON, its cube GENERATED from them.
 *
 * Why a layer and not a stage beside the develop: a conversion LUT must run
 * BEFORE the film response (an emulsion applied to D-Log is nonsense) and
 * only the layer list is ordered by the author. As a layer, everything a look
 * already has — strength, bypass, order, the three Trips rungs, the house
 * style, both file formats — works with no document migration
 * (`docs/film-simulation.md` F2).
 *
 * The generated cube is CACHED by its settings, and that cache is not an
 * optimisation but the feature's viability: generating a 33³ cube runs the
 * emulsion 36 000 times (measured ~106 ms) while composing the layer at some
 * strength costs ~4 ms, so the strength slider must never re-run the emulsion
 * (`media-pipeline.md`). Pure and DOM-free; `restore-grade.ts` and
 * `use-lut-stack.ts` both come through here so a stock is built one way.
 */

import type { CubeLut } from '../lib/cube-parser';
import type { LutLayer } from '../lut/lut-stack';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import {
  filmCube,
  filmSettingsKey,
  readFilmSettings,
  writeFilmSettings,
  type FilmSettings,
} from './emulsion';
import { describeFilm, filmSettingsFor, type FilmStockId } from './stocks';

/** The `source` a film layer carries. */
export const FILM_SOURCE = 'film';

export function isFilmLayer(layer: { source: string }): boolean {
  return layer.source === FILM_SOURCE;
}

/** Generated cubes kept, by settings. A 33³ cube is ~430 KB; a dial drag walks a few dozen. */
const MAX_CACHED = 24;
const cubes = new Map<string, CubeLut>();

/** The cube for these settings — generated once per distinct settings, then read. */
export function filmCubeFor(settings: FilmSettings): CubeLut {
  const key = filmSettingsKey(settings);
  const known = cubes.get(key);
  if (known) return known;
  if (cubes.size >= MAX_CACHED) cubes.clear();
  const cube = filmCube(settings, undefined, describeFilm(settings));
  cubes.set(key, cube);
  return cube;
}

/** Tests only. */
export function clearFilmCubeCache(): void {
  cubes.clear();
}

/**
 * A stored film layer, parsed and ready to bake — or null when its text is
 * not film settings, in which case the layer must be visibly missing, never
 * silently neutral (`restore-grade.ts`'s rule for every look).
 */
export function filmLayerFromSaved(saved: SavedLutLayer): LutLayer | null {
  if (!isFilmLayer(saved)) return null;
  const settings = readFilmSettings(saved.customText);
  if (!settings) return null;
  return {
    id: saved.id,
    source: FILM_SOURCE,
    name: describeFilm(settings),
    lut: filmCubeFor(settings),
    intensity: saved.intensity,
    enabled: saved.enabled,
  };
}

/** A fresh layer seeded from a stock, plus the text the stack stores for it. */
export function newFilmLayer(id: string, stockId: FilmStockId): { layer: LutLayer; text: string } {
  const settings = filmSettingsFor(stockId);
  return {
    layer: {
      id,
      source: FILM_SOURCE,
      name: describeFilm(settings),
      lut: filmCubeFor(settings),
      intensity: 1,
      enabled: true,
    },
    text: writeFilmSettings(settings),
  };
}

/** The same layer over new settings: its name says where it now stands, its cube is regenerated. */
export function withFilmSettings(layer: LutLayer, settings: FilmSettings): { layer: LutLayer; text: string } {
  return {
    layer: { ...layer, name: describeFilm(settings), lut: filmCubeFor(settings) },
    text: writeFilmSettings(settings),
  };
}
