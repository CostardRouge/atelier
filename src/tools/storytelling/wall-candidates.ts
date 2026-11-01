import type { WinnowClient } from '../../shared/sources/winnow/client';
import { rowDay, spanChunks } from '../../shared/sources/winnow/picker/span';
import { counts } from '../../shared/story/story-facts';
import type { CountedSpan } from '../../shared/story/sources';
import { candidateOf, type WallCandidate } from '../../shared/story/wall-pick';

/**
 * The pictures a wall chosen by rules works on (`wall-pick.ts`), read from
 * the series' Winnow: the counted days' — or only those ticked in the picker
 * when he ticked some (his pick) — as the rules need them (verdict, stars,
 * burst, folder, edit, faces, sharpness, fingerprint). A span is read in parts
 * of about 1 000 (two pages), two at a time, every request aborted with the
 * signal; the answer is KEPT for the visit, so a correction on the wall (take
 * one off, pin one) is answered at once without asking the instance again.
 */
const kept = new Map<string, WallCandidate[]>();

export const candidatesKey = (source: string, span: CountedSpan, chosen: readonly (readonly [number, string])[] | null) =>
  `${source}|${span.from}|${span.to}|${(span.skip ?? []).join(',')}|${chosen ? chosen.length + ':' + (chosen[0]?.[0] ?? '') + ':' + (chosen[chosen.length - 1]?.[0] ?? '') : 'all'}`;

/** What was read for this key during the visit, if anything. */
export const keptCandidates = (key: string): WallCandidate[] | null => kept.get(key) ?? null;

export async function readCandidates(
  client: WinnowClient,
  key: string,
  span: CountedSpan,
  chosen: readonly (readonly [number, string])[] | null,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<WallCandidate[]> {
  const hit = kept.get(key);
  if (hit) return hit;
  let out: WallCandidate[];
  if (chosen?.length) {
    // Only what he ticked: asked by id, two hundred at a time, each keeping the day it was ticked under.
    const dayOf = new Map(chosen.map(([id, day]) => [id, day]));
    const ids = chosen.filter(([, day]) => counts(day, span)).map(([id]) => id);
    out = [];
    for (let i = 0; i < ids.length; i += 200) {
      const rows = await client.allAssets({ ids: ids.slice(i, i + 200) }, 400, signal);
      out.push(...rows.map((r) => candidateOf(r, dayOf.get(r.id) ?? rowDay(r) ?? '')));
      onProgress?.(Math.min(ids.length, i + 200), ids.length);
    }
  } else {
    const calendar = await client.calendar(span.from, span.to, {}, signal);
    const parts = spanChunks(calendar.days.filter((d) => counts(d.date, span)), { from: span.from, to: span.to }, 1000);
    const total = parts.reduce((n, p) => n + p.count, 0);
    const got: WallCandidate[][] = parts.map(() => []);
    let done = 0;
    let at = 0;
    const worker = async () => {
      while (at < parts.length) {
        const i = at++;
        const part = parts[i];
        const rows = await client.allAssets({ dateFrom: part.from, dateTo: part.to, limit: 500 }, part.count * 2 + 500, signal);
        got[i] = rows.flatMap((r) => {
          const day = rowDay(r);
          return day && counts(day, span) ? [candidateOf(r, day)] : [];
        });
        done += part.count;
        onProgress?.(done, total);
      }
    };
    await Promise.all([worker(), worker()]);
    out = got.flat();
  }
  kept.set(key, out);
  return out;
}
