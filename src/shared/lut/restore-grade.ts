/**
 * Turning a STORED grade's layers back into the parsed cubes a bake needs.
 *
 * `useLutStack` used to hold this privately, which was fine while a document
 * carried exactly one grade and one stack edited it. It no longer does: a Road
 * Trip deck can give each picture a look of its own, so grades nobody is
 * editing have to be resolved and baked beside the one that is
 * (`use-grade-cubes.ts`). Two resolvers is how a look comes back differently
 * depending on which screen asked for it, so there is one, here.
 *
 * Not pure — a built-in look is fetched, and the manifest it is found in is a
 * Vite virtual module. The arithmetic over a stored grade lives apart, in
 * `saved-grade.ts`, so a node test can read one without any of this.
 */

import { filmLayerFromSaved, isFilmLayer } from '../film/film-layer';
import { parseCube, type CubeLut } from '../lib/cube-parser';
import { BUILTIN_LUTS } from './builtin-luts';
import { isPackLayer, readPackRef } from './lut-pack';
import { identityCube, type LutLayer } from './lut-stack';
import { loadPacks, missingLookReason, packLookName, resolvePackLattice } from './pack-vault';
import type { SavedLutLayer } from './use-lut-stack';

/**
 * Built-ins are fetched, and a deck whose five pictures each convert from
 * D-Log would otherwise fetch and parse the same cube five times. The PROMISE
 * is cached, not the result, so two pictures asking at once share one fetch.
 * A FAILED fetch is forgotten: remembering it would poison that look for the
 * rest of the session over one flaky request.
 */
const builtins = new Map<string, Promise<{ lut: CubeLut; name: string }>>();

export function loadBuiltinLut(builtinId: string): Promise<{ lut: CubeLut; name: string }> {
  const known = builtins.get(builtinId);
  if (known) return known;
  const pending = fetchBuiltin(builtinId);
  pending.catch(() => {
    if (builtins.get(builtinId) === pending) builtins.delete(builtinId);
  });
  builtins.set(builtinId, pending);
  return pending;
}

/** What a built-in id this build does not ship says — the words the native app's panel uses too. */
const GONE_BUILTIN = 'That look is no longer available.';

/**
 * Fetch + parse a built-in by id. Rejects with a readable message — the one a
 * restored layer then SHOWS as its `missing` reason, so a network failure is
 * reworded rather than surfacing as `Failed to fetch`.
 */
async function fetchBuiltin(builtinId: string): Promise<{ lut: CubeLut; name: string }> {
  const entry = BUILTIN_LUTS.find((l) => l.id === builtinId);
  if (!entry) throw new Error(GONE_BUILTIN);
  let res: Response;
  try {
    res = await fetch(entry.url);
  } catch {
    throw new Error(`Could not fetch ${entry.name} — check the connection; the look is kept.`);
  }
  if (!res.ok) throw new Error(`Could not fetch ${entry.name}.`);
  const parsed = parseCube(await res.text());
  if (!parsed) throw new Error(`Could not parse ${entry.name}.`);
  return { lut: parsed, name: entry.name };
}

export interface RestoredLayers {
  layers: LutLayer[];
  /**
   * The stored text of every layer that carries one, by id — a film's
   * settings, a pack reference, an old document's inlined `.cube` — including
   * a layer that came back `missing`, so its saved form is what was read.
   */
  customText: Record<string, string>;
}

/**
 * A stored layer that cannot grade here, kept: named, in its place, its text
 * carried so `toSaved` writes back exactly what was read, and skipped by the
 * bake (`activeLayers`). The fallback name is used only where the document
 * stored none.
 */
function unresolved(s: SavedLutLayer, reason: string): LutLayer {
  const fallback = isFilmLayer(s)
    ? 'Film stock'
    : isPackLayer(s)
      ? 'Pack look'
      : s.source === 'custom'
        ? 'Uploaded look'
        : s.source.replace(/^builtin:/, '');
  return { ...s, name: s.name || fallback, lut: identityCube(), missing: reason };
}

/**
 * A stored grade's layers, parsed and ready to bake. EVERY stored layer comes
 * back, in its order: one that cannot be resolved here — a built-in this build
 * no longer ships or could not fetch, an uploaded cube whose text does not
 * parse, film settings that do not read, a pack look this device's vault does
 * not hold — returns as a layer carrying `missing`, an identity cube and the
 * reason the panel shows.
 *
 * Dropping it instead was a silent DATA LOSS, not a display choice: every host
 * that binds a stack to a document (Develop's `use-roll-grade.ts`, Trips'
 * `use-trip-grade.ts`) writes the stack back whenever its saved form differs
 * from what it restored, so merely OPENING a picture rewrote its stored look
 * without the layer, and the next sync carried the loss to the instance. A
 * kept layer round-trips (`savedLayers`), so an open writes nothing — and a
 * look that grades as identity with no word would read as a working grade
 * that is wrong, so it is never silent either.
 */
export async function restoreLayers(saved: readonly SavedLutLayer[]): Promise<RestoredLayers> {
  const customText: Record<string, string> = {};
  const layers: LutLayer[] = [];
  for (const s of saved) {
    // Carried whatever happens below, so a layer that cannot grade still
    // writes back the text it was read with.
    if (typeof s.customText === 'string') customText[s.id] = s.customText;
    try {
      if (isFilmLayer(s)) {
        // Generated from its settings, never fetched — and the text goes
        // back out with it, so a revert puts the same numbers back.
        const layer = filmLayerFromSaved(s);
        layers.push(
          layer && s.customText
            ? layer
            : unresolved(s, 'This film layer lost its settings — remove it and add the stock again.'),
        );
      } else if (isPackLayer(s)) {
        // A purchased look: the document named it, the vault holds its bytes
        // (`docs/lut-packs.md` §5.2). A device that has not imported the pack
        // yet is an ordinary state, not a broken grade.
        const ref = readPackRef(s.customText);
        if (!ref) {
          layers.push(unresolved(s, 'This look’s reference could not be read.'));
          continue;
        }
        await loadPacks();
        const lut = await resolvePackLattice(ref);
        const name = s.name || packLookName(ref) || 'Pack look';
        layers.push(
          lut
            ? { ...s, name, lut }
            : { ...s, name, lut: identityCube(), missing: missingLookReason(ref) },
        );
      } else if (s.source === 'custom') {
        const parsed = s.customText ? parseCube(s.customText) : null;
        layers.push(parsed ? { ...s, lut: parsed } : unresolved(s, 'This uploaded look could not be read.'));
      } else {
        const { lut, name } = await loadBuiltinLut(s.source.replace(/^builtin:/, ''));
        layers.push({ ...s, name: s.name || name, lut });
      }
    } catch (err) {
      // A built-in this build no longer ships, or could not fetch — and
      // anything else that throws (the vault's database refusing to open).
      layers.push(unresolved(s, err instanceof Error && err.message ? err.message : GONE_BUILTIN));
    }
  }
  return { layers, customText };
}
