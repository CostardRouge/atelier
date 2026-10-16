import { DOC_LOCK_CHANNEL, readLockMessage, type LockMessage } from './doc-lock';

/**
 * The one `BroadcastChannel` this tab speaks to the others on about documents
 * (`doc-lock.ts`): a document changing hands, an editor's save, the preset
 * book written. One per tab, shared by every listener in it — a channel never
 * hears its own posts, so two in one tab would hear each other's.
 */
let channel: BroadcastChannel | null = null;
const listeners = new Set<(m: LockMessage) => void>();

function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(DOC_LOCK_CHANNEL);
    channel.onmessage = (e: MessageEvent) => {
      const m = readLockMessage(e.data);
      if (m) for (const fn of listeners) fn(m);
    };
  }
  return channel;
}

/** Tell the other tabs (never this one). */
export function postDocMessage(m: LockMessage): void {
  ensureChannel()?.postMessage(m);
}

/** Hear the other tabs; returns the way to stop. */
export function onDocMessage(fn: (m: LockMessage) => void): () => void {
  ensureChannel();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
