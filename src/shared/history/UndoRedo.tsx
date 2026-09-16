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
 *
 * It is drawn as ONE control, two halves under one border split by a hairline
 * (2026-09-16): the glyphs are already the same arc mirrored, and two separate
 * squares with a gap cost the tight piece bar a gap and read as two unrelated
 * buttons.
 */

import { Icons } from '../ui/icons';

/**
 * One half of the pair. Not an `IconButton`: the two halves share ONE border,
 * so each half is bare and the frame belongs to the group. A half with nothing
 * to do greys its glyph rather than fading whole (the group's border would
 * fade with it on one side only). The focus ring is drawn inside, since the
 * group clips what overflows its rounded corners.
 */
const HALF =
  'inline-flex items-center justify-center w-[2.0625rem] h-full p-0 border-0 bg-transparent text-ink cursor-pointer ' +
  'transition-colors duration-150 ease-paper hover:bg-paper-2 ' +
  'disabled:text-faint disabled:cursor-default disabled:hover:bg-transparent ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ' +
  '[&>svg]:w-[18px] [&>svg]:h-[18px]';

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
  const undo = canUndo ? `Undo the last ${what} (${keys.undo})` : `Nothing to undo (${keys.undo})`;
  const redo = canRedo ? `Redo the ${what} you undid (${keys.redo})` : `Nothing to redo (${keys.redo})`;
  return (
    <span
      role="group"
      aria-label="History"
      className="inline-flex shrink-0 h-[2.125rem] overflow-hidden rounded-control border border-line-strong bg-surface shadow-[0_1px_1.5px_rgba(27,24,19,0.04)]"
    >
      <button type="button" className={HALF} aria-label={undo} title={undo} onClick={onUndo} disabled={!canUndo}>
        {Icons.undo}
      </button>
      {/* The hairline is its own element: a `border-l` on a half would fight
          the half's `border-0`, and Tailwind orders those by property, not by
          the class list (`frontend.md`). */}
      <span aria-hidden="true" className="w-px self-stretch bg-line" />
      <button type="button" className={HALF} aria-label={redo} title={redo} onClick={onRedo} disabled={!canRedo}>
        {Icons.redo}
      </button>
    </span>
  );
}
