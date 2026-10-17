/**
 * ONE editor per document across the tabs of this browser (DATA-02 of
 * `docs/audit-2026-10-02.md`, his pick B on 2026-10-16). Two tabs on one trip,
 * project or roll used to each keep a copy in memory and each save it: the
 * last writer won and the other's work was gone, said nowhere.
 *
 * The rule: the tab that opens a document first holds its Web Lock and edits
 * it; any other tab shows it READ ONLY, refreshed from the store when the
 * editor saves, with one verb — *Edit here* — that hands the lock over. The
 * editor writes what it still holds before letting go; a tab that does not
 * answer (frozen, hidden too long) has the lock taken from it and drops what
 * it held. When the editor closes the document, a waiting tab takes it on its
 * own.
 *
 * This module is the protocol, pure and DOM-free: the lock's name, and the
 * three messages the tabs pass on one `BroadcastChannel`. The machine that
 * uses them is `use-document-lock.tsx`.
 */

/** The channel every tab of the suite listens on for documents changing hands. */
export const DOC_LOCK_CHANNEL = 'atelier:documents';

/** How long a tab asking for a document waits for the editor to let go before taking it. */
export const YIELD_TIMEOUT_MS = 1500;

/** The kinds of document one tab edits at a time. */
export type LockedKind = 'trip' | 'project' | 'roll' | 'atlas';

/** The Web Lock a document is edited under — one name per kind and id. */
export function lockName(kind: LockedKind, id: string): string {
  return `atelier:doc:${kind}:${id}`;
}

export type LockMessage =
  /** The editor wrote the document: a read-only tab shows the stored copy. */
  | { type: 'saved'; name: string; updatedAt: number }
  /** A read-only tab asks the editor to write what it holds and stop editing. */
  | { type: 'yield'; name: string; asker: string }
  /** The editor wrote what it held and stopped: the asker takes the lock now. */
  | { type: 'yielded'; name: string; asker: string }
  /** The preset book was written — not a locked document: a list that merges (`use-preset-book.ts`). */
  | { type: 'book'; updatedAt: number };

/** A message off the channel, or null when it is not one — anything may post there. */
export function readLockMessage(raw: unknown): LockMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  switch (m.type) {
    case 'saved':
      return text(m.name) && finite(m.updatedAt) ? { type: 'saved', name: m.name, updatedAt: m.updatedAt } : null;
    case 'yield':
    case 'yielded':
      return text(m.name) && text(m.asker) ? { type: m.type, name: m.name, asker: m.asker } : null;
    case 'book':
      return finite(m.updatedAt) ? { type: 'book', updatedAt: m.updatedAt } : null;
    default:
      return null;
  }
}

/**
 * Where a tab stands with the document it has open:
 * - `free` — nothing open, or a browser without Web Locks (it edits, as before);
 * - `asking` — the first answer is not in yet: milliseconds, long before the
 *   800 ms save that would write, which reads the answer when it runs;
 * - `editing` — this tab holds the lock;
 * - `readonly` — another tab does;
 * - `taking` — this tab asked for it with *Edit here* and waits for the hand-over.
 */
export type LockState = 'free' | 'asking' | 'editing' | 'readonly' | 'taking';

/** Whether a tab in `state` may write the document — `asking` is let through (see above). */
export function canWrite(state: LockState): boolean {
  return state === 'free' || state === 'editing' || state === 'asking';
}
