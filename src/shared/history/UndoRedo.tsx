/**
 * The pair of buttons that walks a document's history.
 *
 * It is a PAIR and it is always drawn, both halves, even with nothing to step
 * back to: a control that appears once you have edited something is a control
 * nobody knows is there, and a phone has no ⌘Z at all — these buttons are the
 * only way to undo anywhere without a keyboard. Disabled says "nothing yet",
 * which is a true and useful thing to say.
 *
 * It goes in the `headerExtra` slot every editor already gives its status pill,
 * so it lands in the `PageBar` beside it at the bar's own pill height.
 */

import IconButton from '../ui/IconButton';
import { Icons } from '../ui/icons';

/**
 * The accelerator as this machine's keyboard writes it. Only ever shown in a
 * `title`, which is a mouse's tooltip — a keyboard hint drawn beside a control
 * is a lie a phone pays for in width (`frontend.md`).
 */
function shortcuts(): { undo: string; redo: string } {
  const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
  return mac ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' };
}

export interface UndoRedoProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** What is being stepped through, for the tooltip: "edit", "change". */
  what?: string;
}

export default function UndoRedo({ canUndo, canRedo, onUndo, onRedo, what = 'change' }: UndoRedoProps) {
  const keys = shortcuts();
  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <IconButton
        label={canUndo ? `Undo the last ${what} (${keys.undo})` : `Nothing to undo (${keys.undo})`}
        onClick={onUndo}
        disabled={!canUndo}
      >
        {Icons.undo}
      </IconButton>
      <IconButton
        label={canRedo ? `Redo the ${what} you undid (${keys.redo})` : `Nothing to redo (${keys.redo})`}
        onClick={onRedo}
        disabled={!canRedo}
      >
        {Icons.redo}
      </IconButton>
    </span>
  );
}
