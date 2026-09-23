import { useMemo, useSyncExternalStore } from 'react';
import {
  REMOTE_IDLE_MS,
  newSyncRecord,
  pillText,
  reduceSync,
  shouldFlush,
  type SyncRecord,
} from '../sources/doc-sync';
import { failureEvent, failureOf, isRemoteSource, outcomeEvent } from '../sources/doc-remote';
import { documentSourcesFor, sourceLabel } from '../sources/document-gallery';
import { DEFAULT_SOURCE_ID } from '../sources/source';
import { listWinnowConnections, subscribeWinnowConnections } from '../sources/winnow/store';
import { listTrips } from '../roadtrip/trip-store';
import type { DevelopSettings } from './develop';
import type { SavedGrade } from '../lut/saved-grade';
import type { DevelopPresets } from './develop-host';
import {
  createPresetBook,
  mergeBooks,
  mergeTripPresets,
  removePresetFromBook,
  savePresetInBook,
  withIdentity,
  type PresetBook,
} from './preset-book';
import { EMPTY_IDENTITY, type DeliveryIdentity } from '../exif/delivery-meta';
import {
  PRESET_BOOK_KIND,
  bookRemoteFor,
  deleteRemoteBook,
  listRemoteBooks,
  pullBook,
  pushBookOnce,
} from './preset-book-remote';
import {
  deletePresetBook,
  deleteSyncRecord,
  getPresetBook,
  getSyncRecord,
  putPresetBook,
  putSyncRecord,
} from './roll-store';
import { newRollId } from './roll-types';

/**
 * The preset book, LIVE — one module-level state every Develop host reads:
 * the Trips modal, the Studio modal, the Develop tool. Loaded once per tab,
 * the first time a host subscribes; kept on its source by a small machine of
 * its own, because the book is not a document a tool opens and closes:
 *
 * - LOCAL NOW, REMOTE ON IDLE, like every document (`doc-sync.ts`'s reducer);
 * - on load, ask the instance whether the book moved — a clean copy takes the
 *   server's, a dirty one MERGES (`mergeBooks`) and pushes;
 * - a 412 on push is merged the same way and pushed again, once. A list of
 *   names can always be merged, so no conflict is ever handed to a person;
 * - a book the instance no longer holds (another device took it home) stays
 *   here, kept in this browser;
 * - the trips' old per-trip presets are brought in once per trip, on load.
 *
 * Moving the book is always the person's gesture (`keepPresetBookOn`): Atelier never
 * writes to an instance on its own.
 */

export interface BookState {
  book: PresetBook | null;
  record: SyncRecord | null;
}

let state: BookState = { book: null, record: null };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;

function emit(next: BookState) {
  state = next;
  for (const fn of listeners) fn();
}

function setRecord(record: SyncRecord | null) {
  if (record) void putSyncRecord(record);
  emit({ ...state, record });
}

function schedulePush() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pushBook(false);
  }, REMOTE_IDLE_MS + 50);
}

/** Write the book here, and mark it dirty for its instance when it is kept on one. */
async function commit(book: PresetBook) {
  await putPresetBook(book);
  if (!isRemoteSource(book.sourceId)) {
    emit({ book, record: null });
    return;
  }
  const now = Date.now();
  const rec = state.record?.id === book.id ? state.record : null;
  const record = reduceSync(rec ?? newSyncRecord(book.id, book.sourceId, now), { type: 'edited', now });
  void putSyncRecord(record);
  emit({ book, record });
  schedulePush();
}

/** The server's copy merged under ours, kept here, and pushed over its etag. */
async function mergeFrom(server: PresetBook, etag: string) {
  const local = state.book;
  if (!local) return;
  const merged = mergeBooks(local, server);
  await putPresetBook(merged);
  if (merged.id !== local.id) await deletePresetBook(local.id);
  const now = Date.now();
  const base = reduceSync(state.record ?? newSyncRecord(merged.id, merged.sourceId, now), { type: 'pulled', etag, now });
  const record = reduceSync({ ...base, id: merged.id }, { type: 'edited', now });
  void putSyncRecord(record);
  emit({ book: merged, record });
}

/**
 * Push the book when it is due. A 412 is merged and pushed again, once — and a
 * record left in `conflict` is healed the same way on the next trigger: a list
 * of names always merges, so no conflict is ever held for a person.
 */
async function pushBook(force: boolean): Promise<void> {
  const start = state;
  if (!start.book || !start.record || pushing) return;
  const remote = bookRemoteFor(start.book.sourceId);
  if (!remote) return;
  let merge = start.record.status === 'conflict';
  if (!merge && !shouldFlush(start.record, Date.now(), force ? 0 : REMOTE_IDLE_MS)) return;
  pushing = true;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (merge) {
        const pulled = await pullBook(remote, start.book.id, null);
        if (pulled.kind === 'failed') {
          if (pulled.failure.kind === 'notfound') await keepHere();
          else if (state.record) setRecord(reduceSync(state.record, failureEvent(pulled.failure)));
          return;
        }
        if (pulled.kind === 'fetched') await mergeFrom(pulled.doc, pulled.etag);
      }
      const { book, record } = state;
      if (!book || !record || book.sourceId !== start.book.sourceId) return;
      setRecord(reduceSync(record, { type: 'pushStarted', now: Date.now() }));
      const outcome = await pushBookOnce(remote, book, record.etag);
      if (!outcome.ok && outcome.failure.kind === 'conflict' && attempt === 0) {
        merge = true;
        continue;
      }
      if (state.record) setRecord(reduceSync(state.record, outcomeEvent(outcome, Date.now())));
      return;
    }
  } finally {
    pushing = false;
    // An edit that landed while the push was in flight is still owed a push.
    if (state.record?.status === 'dirty') schedulePush();
  }
}

/**
 * The instance no longer holds the book — another device took it home. This
 * browser keeps its copy, here, and says so; keeping it there again is the
 * person's gesture, as always.
 */
async function keepHere() {
  const { book } = state;
  if (!book) return;
  const next = { ...book, sourceId: DEFAULT_SOURCE_ID, updatedAt: Date.now() };
  await putPresetBook(next);
  await deleteSyncRecord(book.id);
  emit({ book: next, record: null });
}

async function resumeRemote() {
  const { book } = state;
  if (!book || !isRemoteSource(book.sourceId)) return;
  const record = state.record ?? (await getSyncRecord(book.id)) ?? newSyncRecord(book.id, book.sourceId, Date.now());
  setRecord(record);
  const remote = bookRemoteFor(book.sourceId);
  if (!remote) return;
  const pulled = await pullBook(remote, book.id, record.etag);
  if (pulled.kind === 'current') {
    if (record.dirtyAt !== null) void pushBook(true);
    return;
  }
  if (pulled.kind === 'fetched') {
    if (record.dirtyAt === null) {
      const synced = reduceSync(record, { type: 'pulled', etag: pulled.etag, now: Date.now() });
      await putPresetBook(pulled.doc);
      void putSyncRecord(synced);
      emit({ book: pulled.doc, record: synced });
    } else {
      await mergeFrom(pulled.doc, pulled.etag);
      void pushBook(true);
    }
    return;
  }
  if (pulled.failure.kind === 'notfound') await keepHere();
  else setRecord(reduceSync(record, failureEvent(pulled.failure)));
}

function onHidden() {
  if (document.visibilityState === 'hidden') void pushBook(true);
}

/** Load once per tab: the book here (or a new one), the trips' old presets merged in, the instance asked. */
export function ensurePresetBook(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const stored = await getPresetBook();
    let book = stored ?? createPresetBook(newRollId());
    const trips = await listTrips();
    const merged = mergeTripPresets(book, trips);
    const record = isRemoteSource(book.sourceId) ? await getSyncRecord(book.id) : null;
    emit({ book, record });
    if (merged !== book || !stored) {
      book = merged;
      await commit(book);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHidden);
    await resumeRemote();
  })();
  return loading;
}

export async function saveToPresetBook(name: string, settings: DevelopSettings, look: SavedGrade | null = null) {
  await ensurePresetBook();
  if (!state.book) return;
  const next = savePresetInBook(state.book, name, settings, newRollId(), Date.now(), look);
  if (next !== state.book) await commit(next);
}

export async function removeFromPresetBook(id: string) {
  await ensurePresetBook();
  if (!state.book) return;
  const next = removePresetFromBook(state.book, id);
  if (next !== state.book) await commit(next);
}

/** Sign delivered pictures as `identity` — written to the book, and so to every device that finds it. */
export async function setDeliveryIdentity(identity: DeliveryIdentity) {
  await ensurePresetBook();
  if (!state.book) return;
  const next = withIdentity(state.book, identity);
  if (next !== state.book) await commit(next);
}

/**
 * Keep the book on another source — the person's gesture, never automatic.
 * Onto an instance that already holds this account's book (another device put
 * it there): the two are MERGED onto that row. Otherwise the book is written
 * there first and acknowledged before the old copy goes. Back to this browser:
 * the copy there is deleted first, refused while it cannot be reached (no
 * tombstones). Resolves with a sentence when it could not, null when done.
 */
export async function keepPresetBookOn(targetSourceId: string): Promise<string | null> {
  await ensurePresetBook();
  const book = state.book;
  if (!book || targetSourceId === book.sourceId) return null;
  if (pushing) return 'Your presets are being saved — try again in a moment.';
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const origin = isRemoteSource(book.sourceId) ? bookRemoteFor(book.sourceId) : null;
  if (isRemoteSource(book.sourceId) && !origin) {
    return `Connect ${book.sourceId} to move your presets away from it.`;
  }

  let next: PresetBook;
  let record: SyncRecord | null = null;
  if (isRemoteSource(targetSourceId)) {
    const target = bookRemoteFor(targetSourceId);
    if (!target) return `${targetSourceId} cannot keep presets.`;
    let existing: { book: PresetBook; etag: string } | null = null;
    try {
      existing = (await listRemoteBooks(target))[0] ?? null;
    } catch (err) {
      return `Could not reach ${target.label}: ${failureOf(err).message}`;
    }
    const moved = { ...book, sourceId: targetSourceId };
    next = existing ? mergeBooks(moved, existing.book) : moved;
    const outcome = await pushBookOnce(target, next, existing?.etag ?? null);
    if (!outcome.ok) return `Could not save your presets to ${target.label}: ${outcome.failure.message}`;
    const now = Date.now();
    record = reduceSync(newSyncRecord(next.id, targetSourceId, now), { type: 'pushOk', etag: outcome.etag, now });
  } else {
    next = { ...book, sourceId: DEFAULT_SOURCE_ID, updatedAt: Date.now() };
  }

  if (origin) {
    try {
      await deleteRemoteBook(origin, book.id, state.record?.etag ?? null);
    } catch (err) {
      const f = failureOf(err);
      if (f.kind !== 'notfound') {
        return `Could not remove your presets from ${origin.label} (${f.message}) — nothing moved here.`;
      }
    }
  }

  await putPresetBook(next);
  if (next.id !== book.id) await deletePresetBook(book.id);
  await deleteSyncRecord(book.id);
  if (record) await putSyncRecord(record);
  emit({ book: next, record });
  return null;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  void ensurePresetBook();
  return () => listeners.delete(fn);
}

const getSnapshot = () => state;

export function usePresetBook(): BookState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The book as a Develop host hands it to the workbench (`DevelopPresets`):
 * the list, the two verbs, and where it is kept with the way to move it.
 */
export function usePresetBookHost(): DevelopPresets {
  const { book, record } = usePresetBook();
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  return useMemo(() => {
    void connections;
    const sourceId = book?.sourceId ?? DEFAULT_SOURCE_ID;
    const sources = documentSourcesFor(PRESET_BOOK_KIND);
    return {
      list: book?.presets ?? [],
      onSave: (name: string, settings: DevelopSettings, look?: SavedGrade | null) => void saveToPresetBook(name, settings, look ?? null),
      onRemove: (id: string) => void removeFromPresetBook(id),
      keptOn: 'in your own book, shared by every Develop sheet and tool',
      place: {
        label: sourceLabel(sourceId),
        sourceId,
        status: record && isRemoteSource(sourceId) ? pillText(record, sourceLabel(sourceId), Date.now()) : null,
        options: sources.map((s) => ({ id: s.id, label: sourceLabel(s.id) })),
        onKeepOn: keepPresetBookOn,
      },
    };
  }, [book, record, connections]);
}

/** Who signs a delivered picture, live — the empty identity until the book has loaded or one is written. */
export function useDeliveryIdentity(): DeliveryIdentity {
  const { book } = usePresetBook();
  return book?.identity ?? EMPTY_IDENTITY;
}
