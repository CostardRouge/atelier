/**
 * Logs INTO an atlas: each `.srt` read once, its text hashed and kept in the
 * atlas store under that hash (`atlas-store.ts`), and handed back as the
 * flight references an atlas holds (`atlas-doc.ts`). The clip beside a log,
 * when there is one, is asked its aircraft's name now — the atlas keeps that
 * name, since the clip will not be there when the atlas reopens.
 *
 * The text is what makes an atlas whole on this device; a log that cannot be
 * read is named in `failed`, never silently dropped.
 */

import { knownIdentity } from '../../shared/projects/media-identity';
import { yieldToMain } from '../../shared/lib/yield-to-main';
import { flightIdOf, type AtlasFlightRef } from './atlas-doc';
import { sha256Hex } from './atlas-file';
import { putLogs } from './atlas-store';
import { readAircraft } from './read-aircraft';

/** One log to take in, with the clip beside it when the Library holds one. */
export interface IngestItem {
  file: File;
  /** The name the list writes; the file's base name when absent. */
  name?: string;
  video?: File | null;
  /** The id this flight had before it was an atlas's — the Library's asset id. */
  was?: string;
}

export interface Ingested {
  refs: AtlasFlightRef[];
  /** Names of the files that could not be read. */
  failed: string[];
  /** Each `was` and the flight id it became. */
  idOf: Map<string, string>;
  /** False when the store refused the texts (a private window, a full disk): the atlas holds them for this visit only. */
  kept: boolean;
}

/** The texts read this visit, by hash — what the editor draws before the store answers, and where it refused. */
export const sessionLogs = new Map<string, string>();

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export async function ingestLogs(items: readonly IngestItem[], onProgress?: (done: number, total: number) => void): Promise<Ingested> {
  const refs: AtlasFlightRef[] = [];
  const failed: string[] = [];
  const idOf = new Map<string, string>();
  const texts = new Map<string, string>();
  let kept = true;
  for (const [i, item] of items.entries()) {
    try {
      const text = await item.file.text();
      const log = await sha256Hex(text);
      const aircraft = item.video ? await readAircraft(item.video).catch(() => null) : null;
      const winnow = knownIdentity(item.file)?.assetId ?? (item.video ? knownIdentity(item.video)?.assetId : undefined);
      const ref: AtlasFlightRef = {
        id: flightIdOf(log),
        name: item.name ?? baseName(item.file.name),
        log,
        size: text.length,
        ...(aircraft ? { aircraft } : {}),
        ...(winnow ? { winnow } : {}),
      };
      texts.set(log, text);
      sessionLogs.set(log, text);
      refs.push(ref);
      if (item.was) idOf.set(item.was, ref.id);
    } catch {
      failed.push(item.name ?? item.file.name);
    }
    onProgress?.(i + 1, items.length);
    // Kept in batches, so a folder of two hundred logs is a handful of writes.
    if (texts.size >= 32) {
      kept = (await putLogs(texts)) && kept;
      texts.clear();
    }
    if (i % 8 === 7) await yieldToMain();
  }
  if (texts.size) kept = (await putLogs(texts)) && kept;
  return { refs, failed, idOf, kept };
}
