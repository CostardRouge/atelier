/**
 * The bookkeeping of a trip kept on a connected instance — a reducer.
 *
 * A remote trip has a local mirror in IndexedDB; the remote copy is the
 * authority and the mirror is a cache of that ONE document, never a second
 * truth (`docs/roadtrip-persistence.md` §2). This module decides what the
 * mirror knows about its distance from the authority: whether it is dirty,
 * whether a push is due, and — the honesty rule — the exact sentence the
 * status pill prints for every state. No sync engine: one document,
 * last-write-wins, an etag that REFUSES a stale write and says so.
 *
 * The record is NOT on the document. Put there it would leak into the file
 * and onto the wire; it is a sibling row in the same database
 * (`trip-store.ts`, store `sync`). `dirtyAt` persisting is the whole crash
 * story: a tab closed mid-edit leaves the record dirty, and the next open on
 * that device pushes it.
 *
 * Pure and DOM-free; every transition is tested.
 */

export type SyncStatus =
  /** The mirror equals what the server acknowledged. */
  | 'synced'
  /** A local edit is newer than `etag`; a push is due after the idle delay. */
  | 'dirty'
  /** A push is in flight. */
  | 'saving'
  /** The instance did not answer; kept here, retried on the next trigger. */
  | 'offline'
  /** 401: the session there has ended — sign in, then it retries. */
  | 'unauthenticated'
  /** 403: this account may not write there. Stops retrying until reopened. */
  | 'forbidden'
  /** 412: changed elsewhere since our etag. Nothing overwritten; the author decides. */
  | 'conflict'
  /** 404 on push: deleted elsewhere. Keep here as local, or delete here. */
  | 'gone';

/** What the server holds when it refused us — enough for the pill and for "keep mine". */
export interface TheirCopy {
  etag: string;
  /** ISO timestamp, as the server reports it; null when it did not say. */
  updatedAt: string | null;
}

export interface SyncRecord {
  /** The trip id — the same key as the document. */
  id: string;
  /** The host, as `sourceIdFor()` mints it. */
  sourceId: string;
  /** What the server last acknowledged; null = never pushed. */
  etag: string | null;
  syncedAt: number | null;
  /** The LAST local edit newer than `etag`, or null when clean. Survives a reload. */
  dirtyAt: number | null;
  /** When the in-flight push began — an edit after it keeps the record dirty. */
  pushStartedAt: number | null;
  status: SyncStatus;
  /** The last failure's sentence, for the pill; null when there is none. */
  error: string | null;
  /** The server's copy behind a `conflict`; null otherwise. */
  theirs: TheirCopy | null;
}

/** How a push failed, in the client's own vocabulary (`WinnowErrorKind`). */
export type PushFailure =
  | 'unreachable'
  | 'unauthenticated'
  | 'forbidden'
  | 'conflict'
  | 'notfound'
  | 'protocol';

export type SyncEvent =
  | { type: 'edited'; now: number }
  | { type: 'pushStarted'; now: number }
  | { type: 'pushOk'; etag: string; now: number }
  | { type: 'pushFailed'; kind: PushFailure; message?: string; theirs?: TheirCopy }
  | { type: 'pulled'; etag: string; now: number }
  /** After a conflict: re-push over the server's copy, with its etag. */
  | { type: 'resolvedKeepMine' }
  /** After a conflict: the mirror was replaced by the server's copy. */
  | { type: 'resolvedTakeTheirs'; etag: string; now: number };

/** A record for a trip that has never been pushed. */
export function newSyncRecord(id: string, sourceId: string, now: number): SyncRecord {
  return {
    id,
    sourceId,
    etag: null,
    syncedAt: null,
    dirtyAt: now,
    pushStartedAt: null,
    status: 'dirty',
    error: null,
    theirs: null,
  };
}

const FAILURE_STATUS: Record<PushFailure, SyncStatus> = {
  unreachable: 'offline',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  conflict: 'conflict',
  notfound: 'gone',
  // Any other refusal (5xx, a body cap, a bad body) keeps the edit and retries.
  protocol: 'dirty',
};

/** The states that hold until a person acts; an edit does not move them. */
const HELD: ReadonlySet<SyncStatus> = new Set(['conflict', 'gone', 'forbidden']);

export function reduceSync(record: SyncRecord, event: SyncEvent): SyncRecord {
  switch (event.type) {
    case 'edited': {
      // A held state stays held — the author has a decision to make and an
      // edit does not make it for them; the edit is kept in the mirror. A
      // push in flight stays in flight; the edit after it is what `pushOk`
      // reads to know the mirror moved on.
      const status =
        HELD.has(record.status) || record.status === 'saving' ? record.status : 'dirty';
      return { ...record, dirtyAt: event.now, status };
    }
    case 'pushStarted':
      return { ...record, status: 'saving', pushStartedAt: event.now, error: null };
    case 'pushOk': {
      const movedOn =
        record.dirtyAt !== null &&
        record.pushStartedAt !== null &&
        record.dirtyAt > record.pushStartedAt;
      return {
        ...record,
        etag: event.etag,
        syncedAt: event.now,
        pushStartedAt: null,
        error: null,
        theirs: null,
        status: movedOn ? 'dirty' : 'synced',
        dirtyAt: movedOn ? record.dirtyAt : null,
      };
    }
    case 'pushFailed':
      return {
        ...record,
        pushStartedAt: null,
        status: FAILURE_STATUS[event.kind],
        error: event.message ?? null,
        theirs: event.kind === 'conflict' ? (event.theirs ?? null) : null,
      };
    case 'pulled':
    case 'resolvedTakeTheirs':
      return {
        ...record,
        etag: event.etag,
        syncedAt: event.now,
        dirtyAt: null,
        pushStartedAt: null,
        status: 'synced',
        error: null,
        theirs: null,
      };
    case 'resolvedKeepMine':
      // Adopt the server's etag so the next push is accepted; the edit is
      // still ours, so the record is dirty and flushes on the next trigger.
      return {
        ...record,
        etag: record.theirs?.etag ?? record.etag,
        status: 'dirty',
        dirtyAt: record.dirtyAt ?? record.syncedAt ?? 0,
        error: null,
        theirs: null,
      };
  }
}

/** The quiet before a push — long enough that typing does not push per word. */
export const REMOTE_IDLE_MS = 5000;

/**
 * Whether a push is due now. Dirty after the idle delay, yes. Offline or
 * signed out: yes — every trigger is a retry, since only trying can tell that
 * the network or the session is back. Forbidden, conflict, gone: no — a
 * person has to act first. Saving: no, one push at a time.
 */
export function shouldFlush(record: SyncRecord, now: number, idleMs = REMOTE_IDLE_MS): boolean {
  if (record.dirtyAt === null) return false;
  switch (record.status) {
    case 'dirty':
    case 'offline':
    case 'unauthenticated':
      return now - record.dirtyAt >= idleMs;
    default:
      return false;
  }
}

/** "just now", "2 min ago", "3 h ago", "2 days ago". */
export function describeAgo(ms: number): string {
  if (ms < 45_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(ms / 86_400_000);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** `HH:MM` in the reader's own clock, or null when the stamp is unreadable. */
function clockTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * The sentence the pill prints. Every status yields the line it really means
 * — the same rule as the badge panels: no state is described in the abstract
 * when the concrete sentence can be shown.
 */
export function pillText(record: SyncRecord, sourceLabel: string, now: number): string {
  switch (record.status) {
    case 'synced':
      return record.syncedAt === null
        ? `saved to ${sourceLabel}`
        : `saved to ${sourceLabel} · ${describeAgo(now - record.syncedAt)}`;
    case 'dirty':
      return record.error
        ? `could not save to ${sourceLabel}: ${record.error} — kept on this device, will retry`
        : `unsaved changes — saving to ${sourceLabel} shortly`;
    case 'saving':
      return `saving to ${sourceLabel}…`;
    case 'offline':
      return `offline — kept on this device, will retry`;
    case 'unauthenticated':
      return `sign in to ${sourceLabel} to keep saving`;
    case 'forbidden':
      return `this account cannot save on ${sourceLabel} — kept on this device`;
    case 'conflict': {
      const at = clockTime(record.theirs?.updatedAt ?? null);
      return at
        ? `refused: changed on another device at ${at}`
        : 'refused: changed on another device';
    }
    case 'gone':
      return `deleted on ${sourceLabel}`;
  }
}
