/**
 * The person's storage as a SOURCE of documents (`../source.ts`): present
 * while they are signed in with Sésame, beside `local` and any connected
 * Winnow. A document source only — the storage holds no media, so it never
 * reaches the Library, the picker or anything that lists Winnow connections
 * for pictures (`winnow/store.ts` keeps those).
 *
 * What it can keep is its capabilities sheet (`/api/capabilities`), read when
 * the Sources page opens and kept here so a gallery can decide without a
 * request; before the first read, the sheet the storage is known to send is
 * assumed — every kind, summaries, the transport's caps.
 *
 * `localStorage` (`atelier.stockage.v1`), the sheet only — the session is
 * `session.ts`'s.
 */

import { setStoreSources, type SourceInfo } from '../source';
import type { WinnowCapabilities } from '../winnow/client';
import { STOCKAGE_SOURCE_ID, STOCKAGE_URL } from './config';
import { getSesameSession, subscribeSesameSession } from './session';

const KEY = 'atelier.stockage.v1';

export type StockageSheet = Pick<WinnowCapabilities, 'documents' | 'files'> & { version?: string };

/** What the storage answers today (CostardRouge/stockage 0.1.0 + #2), until it is asked. */
export const ASSUMED_SHEET: StockageSheet = {
  documents: { bucket: true, kinds: null, openKinds: true, maxBytes: 96 * 1024 * 1024, summaries: true },
  files: { bucket: true, maxBytes: 90 * 1024 * 1024, quotaBytes: null },
};

let sheet: StockageSheet | null | undefined;
const listeners = new Set<() => void>();
let version = 0;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A stored or fetched sheet read back, or null when it is not one. (pure) */
export function readSheet(raw: unknown): StockageSheet | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const docs = r.documents as Record<string, unknown> | undefined;
  if (!docs || docs.bucket !== true) return null;
  const files = r.files as Record<string, unknown> | undefined;
  return {
    documents: {
      bucket: true,
      kinds: Array.isArray(docs.kinds) ? docs.kinds.filter((k): k is string => typeof k === 'string') : null,
      openKinds: docs.openKinds === true,
      maxBytes: typeof docs.maxBytes === 'number' ? docs.maxBytes : null,
      summaries: docs.summaries === true,
    },
    files: files?.bucket === true
      ? { bucket: true, maxBytes: typeof files.maxBytes === 'number' ? files.maxBytes : null, quotaBytes: null }
      : undefined,
    version: typeof r.version === 'string' ? r.version : undefined,
  };
}

export function stockageSheet(): StockageSheet {
  if (sheet === undefined) {
    try {
      sheet = readSheet(JSON.parse(storage()?.getItem(KEY) ?? 'null'));
    } catch {
      sheet = null;
    }
  }
  return sheet ?? ASSUMED_SHEET;
}

function notify(): void {
  version += 1;
  mirror();
  for (const listener of listeners) listener();
}

/** The source this session offers, or none while signed out. */
export function stockageSourceInfo(): SourceInfo | null {
  if (!getSesameSession()) return null;
  return {
    id: STOCKAGE_SOURCE_ID,
    label: STOCKAGE_SOURCE_ID,
    kind: 'stockage',
    capabilities: { media: false, documents: true, scheduling: false },
  };
}

function mirror(): void {
  const info = stockageSourceInfo();
  setStoreSources(info ? [info] : []);
}

/** Ask the storage what it keeps, and remember it. Throws when it does not answer. */
export async function refreshStockageSheet(fetchImpl: typeof fetch = fetch): Promise<StockageSheet> {
  const res = await fetchImpl(`${STOCKAGE_URL}/api/capabilities`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`${STOCKAGE_SOURCE_ID} answered ${res.status}`);
  const read = readSheet(await res.json());
  if (!read) throw new Error(`${STOCKAGE_SOURCE_ID} did not describe a document bucket`);
  sheet = read;
  try {
    storage()?.setItem(KEY, JSON.stringify(read));
  } catch {
    // Kept for this visit only.
  }
  notify();
  return read;
}

/** A number that changes whenever the storage source appears, leaves or re-describes itself. */
export function stockageVersion(): number {
  return version;
}

export function subscribeStockage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The source follows the session: signing in or out here or in another tab.
if (typeof window !== 'undefined') {
  mirror();
  subscribeSesameSession(notify);
}
