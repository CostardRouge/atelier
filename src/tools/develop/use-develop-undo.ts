import { useCallback, useEffect, useMemo, useRef } from 'react';
import { walkFor, walkTo, type PictureWalk } from '../../shared/develop/picture-walk';
import type { RollDoc } from '../../shared/develop/roll-types';
import { openPictureId } from '../../shared/develop/roll-editor';
import type { HistoryState } from '../../shared/history/history';
import useHistory, { type HistoryOptions } from '../../shared/history/use-history';
import { narrowUndoKeyAction, undoKeyAction } from '../../shared/history/undo-keys';
import { describeKeyTarget } from '../../shared/media/transport-keys';
import { localPref, useLocalPref } from '../../shared/ui/local-pref';

/** What ↶ ↷ step through (2026-10-20, `picture-walk.ts`): the roll's record, or the open photo's part of it. */
export type UndoScope = 'roll' | 'photo';

/** The device's choice, never the roll's: how one person likes to work, on this machine. */
export const undoScopePref = localPref<UndoScope>(
  'atelier.develop.undoScope',
  (raw) => (raw === 'photo' ? 'photo' : 'roll'),
  (v) => (v === 'roll' ? null : v),
);

/**
 * How many steps back the roll's record keeps (his call, 2026-10-20: 200, not
 * the suite's 50). A photo walked back alone reads its past out of this same
 * record, so on a big roll fifty steps left a photo little to go back to. The
 * states share every picture they did not touch, so a step costs a pointer
 * and the changed picture, never a copy of the roll.
 */
export const DEVELOP_HISTORY_LIMIT = 200;

export interface DevelopUndo {
  scope: UndoScope;
  setScope: (scope: UndoScope) => void;
  /** ↶ ↷ as the scope says, and how many steps back they have: the badge's number. */
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  count: number;
  /** The roll's record itself, whatever the scope: its list, a row's jump. */
  roll: {
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
    jump: (delta: number) => void;
    read: () => HistoryState<RollDoc | null>;
    depth: number;
    ahead: number;
  };
  /** The open photo's walk through that record, and the verbs over it; whatever the scope (⌥⌘Z). */
  photo: {
    walk: PictureWalk | null;
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;
    goTo: (index: number) => void;
  };
  /** The record starts again from this roll: it was replaced under the tool, not edited. */
  reset: (doc: RollDoc) => void;
}

/**
 * Develop's undo: the roll's record (`useHistory`) and the open photo's walk
 * through it (`picture-walk.ts`), ↶ ↷ and the keys following the device's
 * scope, ⌥⌘Z walking the photo whatever the scope is.
 */
export default function useDevelopUndo({
  open,
  pictureId,
  write,
  label,
  onRestore,
}: {
  open: RollDoc | null;
  /** The picture the route names (the open one is resolved from it). */
  pictureId: string | null;
  /** The tool's one change funnel: a photo's walk writes through it like an edit. */
  write: (doc: RollDoc) => void;
  label: string;
  onRestore: HistoryOptions<RollDoc | null>['onRestore'];
}): DevelopUndo {
  const [scope, setScope] = useLocalPref(undoScopePref, 'roll');
  const openId = open ? openPictureId(open.pictures, pictureId) : null;

  // The last walk this tool WROTE: still the photo's walk while the photo on
  // the roll is the value it put there (`walkFor`).
  const walked = useRef<PictureWalk | null>(null);
  const walking =
    walked.current !== null &&
    open !== null &&
    walked.current.pictureId === openId &&
    open.pictures.find((p) => p.id === openId) === walked.current.seq[walked.current.i];

  const history = useHistory<RollDoc | null>({
    value: open,
    subject: open?.id ?? null,
    // A walk's write is a step of its own: never merged into the edit before
    // it, nor into the walk's next step.
    label: walking && walked.current ? `walk:${walked.current.pictureId}:${walked.current.i}` : label,
    limit: DEVELOP_HISTORY_LIMIT,
    what: 'edit',
    // ⌘Z is this hook's in the photo's scope.
    enabled: scope === 'roll',
    onRestore,
  });

  const walk = useMemo(() => {
    if (!open || !openId) return null;
    const h = history.read();
    // The render that carries a walk's write comes BEFORE the record takes it.
    const states = h.present === open ? [...h.past, h.present] : [...h.past, h.present, open];
    return walkFor(walking ? walked.current : null, states, openId);
    // The record is a ref: its depth and length say when it moved.
  }, [open, openId, walking, history.depth, history.ahead, history.read]);

  const latest = useRef({ open, walk, write });
  latest.current = { open, walk, write };
  const goTo = useCallback((index: number) => {
    const { open: doc, walk: w, write: put } = latest.current;
    if (!doc || !w) return;
    const step = walkTo(doc, w, index);
    if (!step) return;
    walked.current = step.walk;
    put(step.roll);
  }, []);
  const photoUndo = useCallback(() => {
    const w = latest.current.walk;
    if (w) goTo(w.i - 1);
  }, [goTo]);
  const photoRedo = useCallback(() => {
    const w = latest.current.walk;
    if (w) goTo(w.i + 1);
  }, [goTo]);

  // ⌘Z in the photo's scope, and ⌥⌘Z in both: mount-once, read through refs.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const press = {
        key: e.key,
        code: e.code,
        defaultPrevented: e.defaultPrevented,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        target: describeKeyTarget(e.target),
      };
      const action = narrowUndoKeyAction(press) ?? (scopeRef.current === 'photo' ? undoKeyAction(press) : null);
      if (!action) return;
      e.preventDefault();
      if (action === 'undo') photoUndo();
      else photoRedo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoUndo, photoRedo]);

  const photoCanUndo = !!walk && walk.i > 0;
  const photoCanRedo = !!walk && walk.i < walk.seq.length - 1;
  const photo = scope === 'photo';
  return {
    scope,
    setScope,
    canUndo: photo ? photoCanUndo : history.canUndo,
    canRedo: photo ? photoCanRedo : history.canRedo,
    undo: photo ? photoUndo : history.undo,
    redo: photo ? photoRedo : history.redo,
    count: photo ? (walk?.i ?? 0) : history.depth,
    roll: {
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undo: history.undo,
      redo: history.redo,
      jump: history.jump,
      read: history.read,
      depth: history.depth,
      ahead: history.ahead,
    },
    photo: { walk, canUndo: photoCanUndo, canRedo: photoCanRedo, undo: photoUndo, redo: photoRedo, goTo },
    reset: history.reset,
  };
}
