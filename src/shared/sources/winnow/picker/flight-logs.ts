/**
 * Flight logs READ by the Winnow picker, held for the session.
 *
 * The Logbook draws a clip's real track where a thumbnail would be, which
 * means fetching its `.srt` — a few hundred kilobytes of text — before anyone
 * adds it. Each log is fetched once per session (keyed by its URL), four at a
 * time, and the FILE is kept beside the track: adding the same clips with
 * *Logs only* hands these files back (`materialize`'s `reuse`) instead of
 * asking the instance a second time.
 *
 * Bounded (`KEEP` logs, the oldest forgotten first): a span of a few hundred
 * flights is a few tens of megabytes of text at most.
 */

import { isAbortError } from '../../fetch-options';
import type { WinnowAssetRow, WinnowClient } from '../client';
import { captureMtime, materialize } from '../materialize';
import { flightTrackFromSrt, type FlightTrack } from './flight-track';
import { logFailureOf, logFailureText, type FailedLog } from './log-failures';
import { srtSidecars } from './pick-filter';

export interface ReadLog {
  file: File;
  /** Null when the log holds no located fix. */
  track: FlightTrack | null;
}

const KEEP = 600;
const AT_ONCE = 4;
const held = new Map<string, Promise<ReadLog>>();
const files = new Map<string, File>();

let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  while (active >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/** The log of `row`'s clip, read once per session; null when the clip has none. */
export function readFlightLog(client: WinnowClient, row: WinnowAssetRow): Promise<ReadLog> | null {
  const sidecar = srtSidecars(row)[0];
  if (!sidecar) return null;
  const url = client.sidecarUrl(sidecar.id);
  const known = held.get(url);
  if (known) return known;
  const reading = slot(async () => {
    const file = await client.fetchFile(url, sidecar.filename, 'text/plain', captureMtime(row));
    files.set(url, file);
    return { file, track: flightTrackFromSrt(await file.text()) };
  });
  // A failed read is forgotten, so the next look asks again.
  reading.catch(() => {
    held.delete(url);
    files.delete(url);
  });
  held.set(url, reading);
  while (held.size > KEEP) {
    const oldest = held.keys().next().value as string;
    held.delete(oldest);
    files.delete(oldest);
  }
  return reading;
}

/** A log already read at `url`, for `materialize`'s `reuse`. */
export function heldLog(url: string): File | null {
  return files.get(url) ?? null;
}

/**
 * *Logs only*: each row's `.srt` alone, one after the other, handed to `add`
 * once at the end (also when stopped half-way: what landed is worth having).
 * A log the instance cannot hand over is SKIPPED, never the end of the run —
 * one clip whose drive is unplugged used to stop the whole add at the first
 * miss — and the misses are thrown afterwards as one sentence
 * (`log-failures.ts`), so the picker says it and keeps them ticked.
 *
 * Resolves true when every log landed, false when stopped.
 */
export async function addFlightLogs(
  client: WinnowClient,
  sourceId: string,
  rows: readonly WinnowAssetRow[],
  add: (files: File[]) => void,
  { signal, progress }: { signal: AbortSignal; progress: (line: string) => void },
): Promise<boolean> {
  const files: File[] = [];
  const failed: FailedLog[] = [];
  let added = 0;
  try {
    for (const [i, row] of rows.entries()) {
      if (signal.aborted) break;
      progress(`${i + 1}/${rows.length} · ${row.filename}${failed.length ? ` · ${failed.length} missed` : ''}`);
      try {
        const got = await materialize(client, sourceId, row, { fidelity: 'log', signal, reuse: heldLog });
        files.push(...got);
        if (got.length) added += 1;
      } catch (err) {
        if (isAbortError(err) || signal.aborted) break;
        failed.push({ filename: row.filename, why: logFailureOf(err), message: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    if (files.length) add(files);
  }
  if (signal.aborted) return false;
  if (failed.length) throw new Error(logFailureText(failed, added, sourceId));
  return true;
}
