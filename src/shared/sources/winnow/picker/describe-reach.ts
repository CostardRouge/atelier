/**
 * How FAR a description reaches into the library (his ask of 2026-11-05: «dans Mosaïque … récupérer le plus
 * d'images possible», «intelligemment augmenter la portée de la recherche en fonction du scope demandé par
 * l'instrument»). Winnow ranks the whole library by its image index and hands it over in pages (`/api/search`,
 * `offset`, Winnow #351); the REACH says how deep the picker reads:
 *
 * - **Precise** — the `PRECISE` closest. What a roll, the Library or a wall wants: the best matches.
 * - **Broad** — every row whose distance stays within `BROAD_SLACK` of the BEST one, up to `BROAD_MAX`, page
 *   after page. What a mosaic wants: as many pictures as the description can still claim. Relative to the best,
 *   never an absolute distance — CLIP's distances shift from one query to the next.
 *
 * The instrument sets the default (`PickerHost.reach`), the person may switch it for one search. Pure.
 */

export type Reach = 'precise' | 'broad';

/** How many rows a Precise description keeps — Winnow's old ceiling, and its best matches. */
export const PRECISE = 200;
/** The most a Broad description takes — a mosaic's worth, three pages of Winnow's 1 000. */
export const BROAD_MAX = 3000;
/**
 * How far past the best match a Broad description still reads, in cosine distance. A starting value, not a
 * measured one: on Winnow's default model (`ViT-B-32__openai`) a clear match sits around 0.70 and an unrelated
 * picture around 0.80, so 0.06 keeps the near and the plausible and stops before the noise. Tune it on his library.
 */
export const BROAD_SLACK = 0.06;

interface Ranked {
  distance: number;
}

/** The distance past which a reach stops reading, from the best row it has; Infinity for Precise (it counts). */
export function cutoff(reach: Reach, best: number | null): number {
  if (reach === 'precise' || best === null || !Number.isFinite(best)) return Infinity;
  return best + BROAD_SLACK;
}

/**
 * The rows a reach keeps of what it has read, in their order (closest first). Broad is never narrower than
 * Precise: it keeps the `PRECISE` closest whatever their distance, then everything still within the cutoff.
 */
export function kept<R extends Ranked>(rows: readonly R[], reach: Reach): R[] {
  if (reach === 'precise') return rows.slice(0, PRECISE);
  const limit = cutoff(reach, rows[0]?.distance ?? null);
  const out: R[] = [];
  for (const r of rows) {
    if (out.length >= BROAD_MAX || (out.length >= PRECISE && r.distance > limit)) break;
    out.push(r);
  }
  return out;
}

/**
 * Whether to ask the next page, while the instance has one (`nextOffset`): Precise until it holds its `PRECISE`
 * (an instance whose pages are smaller), Broad until that much AND while the last row read is still within the
 * cutoff, never past the ceiling.
 */
export function wantsMore(rows: readonly Ranked[], reach: Reach, nextOffset: number | null): boolean {
  if (nextOffset === null || rows.length === 0) return false;
  if (rows.length < PRECISE) return true;
  if (reach !== 'broad' || rows.length >= BROAD_MAX) return false;
  return rows[rows.length - 1].distance <= cutoff(reach, rows[0].distance);
}

/** How many rows to ask per page for a reach on an instance that hands `pageSize` at most. */
export function pageFor(reach: Reach, pageSize: number): number {
  return reach === 'precise' ? Math.min(PRECISE, pageSize) : Math.min(pageSize, BROAD_MAX);
}
