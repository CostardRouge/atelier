/**
 * Carrying the preset book to and from the instance it is kept on, filed under
 * `kind: 'presets'` — the roll driver's shape, over the same plumbing. Every
 * lookup passes the kind, so an instance whose bucket does not keep books is
 * simply not offered. No DOM; never throws except where it says it does.
 */

import { DOCS_APP, WinnowError, type WinnowDocRow } from '../sources/winnow/client';
import type { PullOutcome } from '../sources/doc-sync';
import { failureOf, putDocOnce, remoteFor, type PushOutcome, type RemoteSource } from '../sources/doc-remote';
import { bookToWire, readPresetBook, type PresetBook } from './preset-book';

export const PRESET_BOOK_KIND = 'presets';

export function bookRemoteFor(sourceId: string): RemoteSource | null {
  return remoteFor(sourceId, PRESET_BOOK_KIND);
}

/** A stored body back into a book, id and source from the request; refused when it is not a book. */
export function bookFromWire(raw: unknown, id: string, sourceId: string): PresetBook {
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : null;
  const book = body ? readPresetBook({ ...body, id, sourceId }, sourceId) : null;
  if (!book) throw new WinnowError('protocol', `The stored copy of ${id} is not a preset book.`);
  return book;
}

/** One guarded PUT. Never throws. */
export function pushBookOnce(remote: RemoteSource, book: PresetBook, etag: string | null): Promise<PushOutcome> {
  return putDocOnce(remote, PRESET_BOOK_KIND, book.id, book.version, bookToWire(book), etag);
}

/** The server's copy unless ours is still it. Never throws. */
export async function pullBook(remote: RemoteSource, id: string, ifNoneMatch: string | null): Promise<PullOutcome<PresetBook>> {
  try {
    const r = await remote.client.getDoc(DOCS_APP, id, ifNoneMatch);
    if (r === 'not-modified') return { kind: 'current' };
    return { kind: 'fetched', doc: bookFromWire(r.row.doc, id, remote.sourceId), etag: r.row.etag, updatedAt: r.row.updated_at };
  } catch (err) {
    return { kind: 'failed', failure: failureOf(err) };
  }
}

/**
 * The books this account keeps there, newest first — how a second device finds
 * the book the first one put there. Throws the client's error.
 */
export async function listRemoteBooks(remote: RemoteSource): Promise<{ book: PresetBook; etag: string }[]> {
  const rows = await remote.client.listDocs(DOCS_APP, PRESET_BOOK_KIND);
  const out: { book: PresetBook; etag: string; at: string }[] = [];
  for (const row of rows as WinnowDocRow[]) {
    try {
      out.push({ book: bookFromWire(row.doc, row.id, remote.sourceId), etag: row.etag, at: row.updated_at });
    } catch {
      // Not a book: skipped rather than taking the list down.
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).map(({ book, etag }) => ({ book, etag }));
}

/** Delete there. Throws the client's error. */
export async function deleteRemoteBook(remote: RemoteSource, id: string, etag: string | null): Promise<void> {
  await remote.client.deleteDoc(DOCS_APP, id, etag);
}
