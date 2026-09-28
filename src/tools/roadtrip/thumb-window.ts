/**
 * Which hooks a sliding window of pieces must READ and which it must LET GO —
 * pure, tested; `use-day-thumbs.ts` does the reading and the object URLs.
 *
 * The overview's pictures view holds the month on screen and its two
 * neighbours. Crossing a month boundary moves that window by a month, so two
 * of its three months are already held: re-reading them from IndexedDB and
 * minting new URLs for them is what made every cell flash at each boundary.
 */
export interface ThumbWindowStep {
  /** Ids wanted and not held yet: the only ones read. */
  missing: string[];
  /** Ids held and no longer wanted: their URLs are revoked. */
  dropped: string[];
}

export function thumbWindowStep(held: Iterable<string>, wanted: readonly string[]): ThumbWindowStep {
  const want = new Set(wanted);
  const have = new Set(held);
  const missing: string[] = [];
  for (const id of want) if (!have.has(id)) missing.push(id);
  const dropped: string[] = [];
  for (const id of have) if (!want.has(id)) dropped.push(id);
  return { missing, dropped };
}
