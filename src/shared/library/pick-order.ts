/**
 * The order a ticked handful of pictures is added in — the order they were
 * ticked, or the order they were TAKEN.
 *
 * Ticking is how a person says the order (the tile shows each pick's number,
 * so the result is read before it is written); time is the shortcut when the
 * story is the day's own order. A picture with no known time keeps its tick
 * order behind the dated ones, so nothing is shuffled by a missing date.
 *
 * Pure and DOM-free.
 */

export interface Pick {
  key: string;
  /** When it was taken, in ms since the epoch, or null when nobody knows. */
  at: number | null;
}

/** The keys in the order they will be added. `picks` is in tick order. */
export function orderPicks(picks: readonly Pick[], byTime: boolean): string[] {
  if (!byTime) return picks.map((p) => p.key);
  return picks
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => {
      if (a.at === null || b.at === null) {
        if (a.at === null && b.at === null) return a.i - b.i;
        return a.at === null ? 1 : -1;
      }
      return a.at - b.at || a.i - b.i;
    })
    .map((p) => p.key);
}

/** A row's capture instant as a number, or null — Winnow's `captured_at`, read leniently. */
export function instantOf(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : null;
}
