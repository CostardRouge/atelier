/**
 * The record touched last among raw store records — the one a Home door
 * shows, picked BEFORE any migration so the others are never migrated for
 * nothing (audit PERF-05). A record with no `updatedAt` (one written before
 * the field, or a stranger) counts as the oldest. Pure.
 */
export function latestOf<T extends { updatedAt?: number }>(records: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of records) if (!best || (r.updatedAt ?? 0) > (best.updatedAt ?? 0)) best = r;
  return best;
}
