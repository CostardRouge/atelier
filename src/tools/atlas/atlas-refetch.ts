/**
 * Logs fetched BACK from the Winnow a flight came from — the other device's
 * half of keeping an atlas on an instance. The atlas travels with its flights
 * by reference only (`atlas-remote.ts`), so an atlas opened where its logs
 * were never added has the hash of each log and, for a flight that came from
 * Winnow, the clip's id: its `.srt` is asked for again, alone, and kept only
 * when its text hashes to what the flight names. A text that does not match
 * is left out and counted, never put under the flight.
 */

import type { WinnowAssetRow, WinnowClient } from '../../shared/sources/winnow/client';
import { fetchLog } from '../../shared/sources/winnow/materialize';
import type { AtlasFlightRef } from './atlas-doc';
import { sha256Hex } from './atlas-file';
import { sessionLogs } from './atlas-ingest';
import { putLogs } from './atlas-store';

/** The asset id a flight's `<host>/<id>` names on `host`, or null. */
export function winnowIdOn(ref: AtlasFlightRef, host: string): number | null {
  const prefix = `${host}/`;
  if (!ref.winnow?.startsWith(prefix)) return null;
  const id = Number(ref.winnow.slice(prefix.length));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The instance a flight came from, by its `<host>/<id>`. */
export function hostOf(ref: AtlasFlightRef): string | null {
  const at = ref.winnow?.lastIndexOf('/') ?? -1;
  return at > 0 ? (ref.winnow as string).slice(0, at) : null;
}

export interface Refetched {
  /** Logs kept again, by hash. */
  found: number;
  /** Clips the instance no longer has, or that carry no log. */
  gone: number;
  /** Logs whose text did not match the flight's hash. */
  changed: number;
  /** Requests that failed (the instance, the network). */
  failed: number;
}

export async function fetchLogsBack(
  client: WinnowClient,
  host: string,
  refs: readonly AtlasFlightRef[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Refetched> {
  const wanted = refs.flatMap((r) => {
    const id = winnowIdOn(r, host);
    return id === null ? [] : [{ ref: r, id }];
  });
  const out: Refetched = { found: 0, gone: 0, changed: 0, failed: 0 };
  if (!wanted.length) return out;
  let rows: Map<number, WinnowAssetRow>;
  try {
    rows = new Map((await client.assetsByIds(wanted.map((w) => w.id))).map((r) => [r.id, r]));
  } catch {
    out.failed = wanted.length;
    return out;
  }
  const texts = new Map<string, string>();
  for (const [i, { ref, id }] of wanted.entries()) {
    if (signal?.aborted) break;
    const row = rows.get(id);
    try {
      const got = row ? await fetchLog(client, row, { signal }) : null;
      if (!got) out.gone += 1;
      else {
        const text = await got.file.text();
        if ((await sha256Hex(text)) !== ref.log) out.changed += 1;
        else {
          texts.set(ref.log, text);
          sessionLogs.set(ref.log, text);
          out.found += 1;
        }
      }
    } catch {
      if (signal?.aborted) break;
      out.failed += 1;
    }
    onProgress?.(i + 1, wanted.length);
  }
  if (texts.size) await putLogs(texts);
  return out;
}
