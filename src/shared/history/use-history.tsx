import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  canRedo as hasRedo,
  canUndo as hasUndo,
  newHistory,
  record,
  redo as redoState,
  seal as sealState,
  undo as undoState,
  type HistoryState,
} from './history';
import { undoKeyAction } from './undo-keys';
import { describeKeyTarget } from '../media/transport-keys';
import UndoRedo from './UndoRedo';

export interface HistoryOptions<T> {
  /** The document as it is now. The hook WATCHES it: whatever arrives that it did not put back is an edit. */
  value: T;
  /**
   * Put a state back. The tool applies it exactly as it applies an edit — the
   * same setter, the same save — and the hook recognises what comes back by
   * identity, so it is not recorded as a new edit.
   */
  onRestore: (value: T) => void;
  /**
   * Which document this is (an id). When it changes the history starts again:
   * another document has another past.
   */
  subject?: string | null;
  /** What the current edit is about; two edits merge into one step only under the same label. */
  label?: string | null;
  /** False where the keyboard belongs to something else — a sheet with its own draft. */
  enabled?: boolean;
  /**
   * False while the editor is still SEEDING itself from the document: whatever
   * arrives then is not an edit but the document finishing its own arrival, and
   * it becomes the beginning rather than a step. What it is for: the Studio
   * restores its saved grade asynchronously (every built-in cube is fetched
   * again), so the looks land after the first render — and a project opened
   * with a grade would otherwise offer an undo that strips it.
   */
  ready?: boolean;
  /** How two values are compared. `Object.is` unless the value is a slice rebuilt per render (`shallowSame`). */
  isSame?: (a: T, b: T) => boolean;
  limit?: number;
  coalesceMs?: number;
  /** The word the buttons use for one step: "edit", "change". */
  what?: string;
}

export interface DocumentHistory<T> {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Start again from this state: the document was REPLACED under the tool, not edited. */
  reset: (value: T) => void;
  /** Close the open step, so the next edit starts a new one whatever the clock says. */
  seal: () => void;
  /** The two buttons, for the editor's `headerExtra` slot. */
  control: ReactNode;
}

/**
 * Undo and redo for a document a tool holds — the React half of `history.ts`.
 *
 * It WATCHES rather than intercepts: the tool keeps its one change funnel, and
 * the hook records every value that arrives through it. Nothing at the call
 * sites changes, which is the only shape that could cover editors with a few
 * hundred of them each, and a control added to a panel tomorrow is undoable
 * without knowing this exists.
 *
 * The trick that makes watching work is IDENTITY: restoring hands the tool the
 * very object the history holds, so when it comes back down the hook sees its
 * own state rather than an edit. A tool whose "document" is a slice assembled
 * from several `useState` values cannot preserve identity — it rebuilds the
 * slice — and passes `isSame: shallowSame` instead.
 *
 * ⌘Z / ⇧⌘Z (and Ctrl+Z / Ctrl+Y) are bound on `window` like the transport's
 * space and every modal's Escape, and stand down for the focused element
 * through `undo-keys.ts`.
 */
export default function useHistory<T>(options: HistoryOptions<T>): DocumentHistory<T> {
  const latest = useRef(options);
  latest.current = options;
  const { value, subject = null } = options;

  const history = useRef<HistoryState<T>>(newHistory(value));
  const subjectRef = useRef<string | null>(subject);
  const readyRef = useRef(options.ready !== false);
  const [steps, setSteps] = useState({ undo: false, redo: false });

  /** The record is a ref (a restore must read it synchronously); this is what the buttons see. */
  const publish = useCallback(() => {
    const h = history.current;
    setSteps((prev) => {
      const next = { undo: hasUndo(h), redo: hasRedo(h) };
      return prev.undo === next.undo && prev.redo === next.redo ? prev : next;
    });
  }, []);

  // Everything the tool hands back down, except what this hook just put there.
  useEffect(() => {
    const { isSame, label = null, limit, coalesceMs, ready = true } = latest.current;
    // The commit where seeding ENDS may carry the last of it — React is free to
    // batch the two — so the transition reseeds as well, not only the commits
    // before it.
    const justReady = ready && !readyRef.current;
    readyRef.current = ready;
    if (subjectRef.current !== subject || !ready || justReady) {
      subjectRef.current = subject;
      history.current = newHistory(value);
      publish();
      return;
    }
    const same = isSame ?? Object.is;
    if (same(value, history.current.present)) return;
    history.current = record(history.current, value, { now: Date.now(), label, limit, coalesceMs });
    publish();
  }, [value, subject, options.ready, publish]);

  const step = useCallback(
    (move: (h: HistoryState<T>) => HistoryState<T>) => {
      const next = move(history.current);
      if (next === history.current) return;
      history.current = next;
      publish();
      latest.current.onRestore(next.present);
    },
    [publish],
  );

  const undo = useCallback(() => step(undoState), [step]);
  const redo = useCallback(() => step(redoState), [step]);

  const reset = useCallback(
    (next: T) => {
      subjectRef.current = latest.current.subject ?? null;
      history.current = newHistory(next);
      publish();
    },
    [publish],
  );

  const seal = useCallback(() => {
    history.current = sealState(history.current);
  }, []);

  // Mount-once, like the transport's space key: the handlers are read through
  // the refs above, so a document edited on every keystroke does not re-bind
  // the listener on every keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (latest.current.enabled === false) return;
      const action = undoKeyAction({
        key: e.key,
        defaultPrevented: e.defaultPrevented,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: describeKeyTarget(e.target),
      });
      if (!action) return;
      // Nothing else may act on this press: the browser's own undo would
      // otherwise fire as well, on whatever field it last touched.
      e.preventDefault();
      if (action === 'undo') undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const control = (
    <UndoRedo
      canUndo={steps.undo}
      canRedo={steps.redo}
      onUndo={undo}
      onRedo={redo}
      what={options.what}
    />
  );

  return { canUndo: steps.undo, canRedo: steps.redo, undo, redo, reset, seal, control };
}
