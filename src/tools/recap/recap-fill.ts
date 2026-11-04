import type { RecapDoc, RecapPicture } from '../../shared/recap/recap-doc';
import { templateDays } from '../../shared/recap/recap-slots';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { pictureOfRow } from './recap-media';

/**
 * The days a fill asks a Winnow for, as `[from, to]` windows: one for a run
 * of days (a month, a week, a period), one per day for days apart (on this
 * day's steps back) — a request per window, never one per day of a month.
 * Pure.
 */
export function fillWindows(days: readonly string[]): [string, string][] {
  const sorted = [...new Set(days)].sort();
  const out: [string, string][] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && Date.parse(`${d}T00:00:00Z`) - Date.parse(`${last[1]}T00:00:00Z`) <= 86400000) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

/** Per window at most: a busy month of a Winnow, short of a runaway list. */
const CAP_PER_WINDOW = 4000;

/**
 * Every picture the recap's RULE reads, asked of the connected Winnow —
 * references and the facts the rule ranks on (day, hour, device, stars, the
 * pick), nothing fetched yet: a print is made only for a picture a slot
 * shows. Rejects are left out (the point is the best of a day).
 */
export async function fillFromWinnow(doc: RecapDoc, client: WinnowClient, instance: string, signal?: AbortSignal): Promise<RecapPicture[]> {
  const out: RecapPicture[] = [];
  for (const [from, to] of fillWindows(templateDays(doc))) {
    if (signal?.aborted) break;
    const rows = await client.allAssets({ dateFrom: from, dateTo: to }, CAP_PER_WINDOW, signal);
    for (const row of rows) {
      if (row.verdict === 'reject') continue;
      if (row.media_type !== 'photo' && row.media_type !== 'video') continue;
      out.push(pictureOfRow(row, instance));
    }
  }
  return out;
}
