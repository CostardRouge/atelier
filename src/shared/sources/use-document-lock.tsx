import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '../ui/Button';
import { Icons } from '../ui/icons';
import {
  YIELD_TIMEOUT_MS,
  canWrite as stateCanWrite,
  lockName,
  type LockState,
  type LockedKind,
} from './doc-lock';
import { onDocMessage, postDocMessage } from './doc-channel';

/** This tab, as the hand-over messages name it. */
const TAB = Math.random().toString(36).slice(2);

/** How long an editor that wrote and let go waits to be taken before it takes the document back. */
const TAKEN_TIMEOUT_MS = 3000;
// Kept above YIELD_TIMEOUT_MS: an asker steals at that delay at the latest.

/** Web Locks and a channel to say so: without either, every tab edits as before. */
function supported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks && typeof BroadcastChannel !== 'undefined';
}

export interface DocumentLockOptions<D> {
  kind: LockedKind;
  /** The document open in the tool, or null. */
  id: string | null;
  /** Write what the tool still holds — before the document is handed to another tab. */
  flush: () => Promise<void>;
  /** Drop what the tool still holds — the lock was TAKEN from a tab that did not answer. */
  discard: () => void;
  /** The stored copy, as the editor last wrote it. */
  load: (id: string) => Promise<D | null>;
  /**
   * Show a reloaded copy: not an edit (the history starts again from it).
   * `editing` when this tab has just TAKEN the document — it reads its sync
   * record again then, since the other tab kept it moving meanwhile.
   */
  onReload: (doc: D, editing: boolean) => void;
}

export interface DocumentLock {
  state: LockState;
  /** Whether this tab may write the document now — read at the save, never cached. */
  canWrite: () => boolean;
  /** The local write landed: the read-only tabs show it. */
  saved: (doc: { id: string; updatedAt: number }) => void;
  /** *Edit here*: ask the editor to let go, then take the document. */
  takeOver: () => void;
  /** Whether the tool's editor is shown read only (to be made inert). */
  readOnly: boolean;
  /** The band a read-only tab draws above its editor, or null. */
  band: ReactNode;
}

/**
 * ONE editor per document across this browser's tabs (`doc-lock.ts`): the
 * tool says which document it has open and how to write, drop and reload it;
 * the hook holds the document's Web Lock while this tab edits it, shows it
 * read only while another does, refreshes it when that tab saves (now if this
 * tab is on screen, else when it comes back), and hands it over on *Edit
 * here* — the editor writing first. A tool guards its ONE save path with
 * `canWrite()` and makes its editor inert while `readOnly`.
 */
export function useDocumentLock<D>(options: DocumentLockOptions<D>): DocumentLock {
  const opts = useRef(options);
  opts.current = options;
  const { kind, id } = options;

  const [state, setStateRaw] = useState<LockState>(() => (id && supported() ? 'asking' : 'free'));
  const stateRef = useRef(state);
  const setState = useCallback((s: LockState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);
  /** *Edit here* for the document open now — set by the effect below. */
  const takeOverRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!id || !supported()) {
      setState('free');
      return;
    }
    setState('asking');
    const name = lockName(kind, id);
    let alive = true;
    let holding = false;
    let release: (() => void) | null = null;
    let waiting: AbortController | null = null;
    let stale = false;
    let takeTimer: number | null = null;
    let givenTimer: number | null = null;
    /** A hand-over's timers belong to that hand-over: a later one must never fire into the next. */
    const clearTimers = () => {
      if (takeTimer !== null) window.clearTimeout(takeTimer);
      if (givenTimer !== null) window.clearTimeout(givenTimer);
      takeTimer = null;
      givenTimer = null;
    };

    const reload = async (editing = false) => {
      const doc = await opts.current.load(id);
      if (alive && doc) opts.current.onReload(doc, editing);
    };

    /** Lost or never had it: read only, the stored copy shown, in line for it. */
    const becomeReader = () => {
      setState('readonly');
      void reload();
      wait();
    };

    const grant = async (fromOther: boolean) => {
      clearTimers();
      holding = true;
      setState('editing');
      // Whoever had it may have written since this tab last read the store.
      if (fromOther) await reload(true);
      if (!alive) return;
      await new Promise<void>((resolve) => {
        release = () => {
          release = null;
          resolve();
        };
      });
      holding = false;
    };

    /** A lock request whose rejection means the lock was TAKEN, when it was held. */
    const request = (lockOptions: LockOptions, onGrant: (lock: Lock | null) => Promise<void> | void) => {
      navigator.locks.request(name, lockOptions, onGrant).catch(() => {
        if (!alive || !holding) return;
        // Taken by a tab that asked and got no answer in time: what this tab
        // still held never reaches the store.
        holding = false;
        release = null;
        clearTimers();
        opts.current.discard();
        becomeReader();
      });
    };

    function wait() {
      waiting?.abort();
      const ctl = new AbortController();
      waiting = ctl;
      request({ signal: ctl.signal }, async (lock) => {
        if (!alive || !lock || waiting !== ctl) return;
        waiting = null;
        await grant(true);
      });
    }

    const steal = () => {
      clearTimers();
      waiting?.abort();
      waiting = null;
      request({ steal: true }, async (lock) => {
        if (!alive || !lock) return;
        await grant(true);
      });
    };

    request({ ifAvailable: true }, async (lock) => {
      if (!alive) return;
      if (!lock) {
        becomeReader();
        return;
      }
      await grant(false);
    });

    takeOverRef.current = () => {
      if (stateRef.current !== 'readonly') return;
      setState('taking');
      postDocMessage({ type: 'yield', name, asker: TAB });
      takeTimer = window.setTimeout(steal, YIELD_TIMEOUT_MS);
    };

    const stop = onDocMessage((m) => {
      if (!alive) return;
      if (m.type === 'saved' && m.name === name && stateRef.current === 'readonly') {
        if (document.visibilityState === 'visible') void reload();
        else stale = true;
      } else if (m.type === 'yield' && m.name === name && holding && stateRef.current === 'editing') {
        // Write what is held, stop writing, then say so: a save that lands
        // after this point is refused (`canWrite`). The asker takes the lock;
        // if it never does, take the document back.
        void opts.current.flush().then(() => {
          if (!alive || !holding) return;
          setState('readonly');
          postDocMessage({ type: 'yielded', name, asker: m.asker });
          givenTimer = window.setTimeout(() => {
            givenTimer = null;
            if (alive && holding) {
              release?.();
              wait();
            }
          }, TAKEN_TIMEOUT_MS);
        });
      } else if (m.type === 'yielded' && m.name === name && m.asker === TAB && stateRef.current === 'taking') {
        steal();
      }
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible' && stale && stateRef.current === 'readonly') {
        stale = false;
        void reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      clearTimers();
      waiting?.abort();
      release?.();
      takeOverRef.current = () => {};
    };
  }, [kind, id, setState]);

  const saved = useCallback(
    (doc: { id: string; updatedAt: number }) => {
      if (stateRef.current !== 'editing' || doc.id !== opts.current.id) return;
      postDocMessage({ type: 'saved', name: lockName(kind, doc.id), updatedAt: doc.updatedAt });
    },
    [kind],
  );
  const canWrite = useCallback(() => stateCanWrite(stateRef.current), []);
  const takeOver = useCallback(() => takeOverRef.current(), []);

  const readOnly = state === 'readonly' || state === 'taking';
  const band = readOnly ? <ReadOnlyBand taking={state === 'taking'} onTakeOver={takeOver} /> : null;
  return useMemo(() => ({ state, canWrite, saved, takeOver, readOnly, band }), [state, canWrite, saved, takeOver, readOnly, band]);
}

/**
 * What a read-only tab says, above its editor: one line and one verb. The
 * editor under it is inert, so this is the only control alive on the screen
 * that edits — and the reason it is so.
 */
function ReadOnlyBand({ taking, onTakeOver }: { taking: boolean; onTakeOver: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-paper border border-line bg-paper-2 px-3 py-2 text-xs text-ink-soft"
      role="status"
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        <span className="flex-none inline-flex text-muted" aria-hidden="true">
          {Icons.eye}
        </span>
        <span>Open in another tab — read only here.</span>
      </span>
      <span className="flex-1" />
      <Button size="sm" variant="primary" onClick={onTakeOver} aria-disabled={taking || undefined}>
        {taking ? 'Taking over…' : 'Edit here'}
      </Button>
    </div>
  );
}

/** An element made inert while `on` — React 18 has no `inert` prop, the DOM does (`Inspector.tsx`). */
export function useInertRef<T extends HTMLElement>(on: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = on;
  });
  return ref;
}
