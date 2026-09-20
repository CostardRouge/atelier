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

/** Fetch + parse a built-in by id. Rejects with a readable message. */
async function fetchBuiltin(builtinId: string): Promise<{ lut: CubeLut; name: string }> {
  const entry = BUILTIN_LUTS.find((l) => l.id === builtinId);
  if (!entry) throw new Error('That look is no longer available.');
  const res = await fetch(entry.url);
  const parsed = parseCube(await res.text());
  if (!parsed) throw new Error(`Could not parse ${entry.name}.`);
  return { lut: parsed, name: entry.name };
}

export interface RestoredLayers {
  layers: LutLayer[];
  /** The raw `.cube` text of every uploaded layer, and the settings of every film layer, by id. */
  customText: Record<string, string>;
}

/**
 * A stored grade's layers, parsed and ready to bake. A look that no longer
 * exists — a built-in this build dropped, an uploaded cube whose text did not
 * survive — simply does not come back, rather than being graded as identity:
 * a missing look must be visible, not silently neutral.
 *
 * A PACK look is the one exception, and for the same reason: its bytes live
 * in the vault rather than in the document, so a device that has not imported
 * the pack yet is an ordinary state, not a broken grade. It comes back as a
 * layer carrying `missing` — named, in its place, skipped by the bake.
 */
export async function restoreLayers(saved: readonly SavedLutLayer[]): Promise<RestoredLayers> {
  const customText: Record<string, string> = {};
  const layers: LutLayer[] = [];
  for (const s of saved) {
    try {
      if (isFilmLayer(s)) {
        // Generated from its settings, never fetched — and the text goes
        // back out with it, so a revert puts the same numbers back.
        const layer = filmLayerFromSaved(s);
        if (!layer || !s.customText) continue;
        customText[s.id] = s.customText;
        layers.push(layer);
      } else if (isPackLayer(s)) {
        // A purchased look: the document named it, the vault holds its bytes
        // (`docs/lut-packs.md` §5.2). A reference that resolves to nothing
        // here still comes back as a LAYER that says why — the one look in
        // the suite that is kept without a cube.
        const ref = readPackRef(s.customText);
        if (!ref || !s.customText) continue;
        customText[s.id] = s.customText;
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
        if (!parsed || !s.customText) continue;
        customText[s.id] = s.customText;
        layers.push({ ...s, lut: parsed });
      } else {
        const { lut, name } = await loadBuiltinLut(s.source.replace(/^builtin:/, ''));
        layers.push({ ...s, name: s.name || name, lut });
      }
    } catch {
      // A look that no longer exists just doesn't come back.
    }
  }
  return { layers, customText };
}
