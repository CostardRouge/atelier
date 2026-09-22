import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { cancelTask, overallProgress, pillWord, tasksSentence } from '../tasks/tasks';
import { useTasks } from '../tasks/use-tasks';
import { TaskBar } from './TaskEdge';

/** The panel's width, in px — the same number its `w-[min(20rem,…)]` resolves to. */
const PANEL_WIDTH = 320;
const EDGE = 8;
const HOVER_CLOSE_MS = 160;

/**
 * What is running, as one pill in the masthead — the `SyncPill` family
 * (`frontend.md`, «a status whose sentence nobody controls the length of»):
 * a pulsing dot and one word, the list in a popover with a bar per task and
 * a Cancel where the work can really stop. His pop-up, without being a modal
 * that blocks the page: the reason he wanted a cancel is to go on doing
 * something else, and a modal forbids exactly that
 * (`docs/progress-feedback.md` §4, question 1).
 *
 * Draws nothing when nothing is running, and nothing under 400 ms. On a
 * phone the word goes and the dot stays — the masthead is the one row every
 * screen keeps, so the pill has a home at every width (question 3), and the
 * media's own edge (`TaskEdge`) is the surface a thumb reads there.
 */
export default function TaskPill({ compact = false }: { compact?: boolean }) {
  const tasks = useTasks();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pinned = useRef(false);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const close = useCallback(() => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
  }, []);
  const openPanel = useCallback(() => {
    cancelClose();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * EDGE);
      const room = Math.max(EDGE, window.innerWidth - width - EDGE);
      setOffset(Math.min(Math.max(rect.left, EDGE), room) - rect.left);
    }
    setOpen(true);
  }, []);
  useEffect(() => () => cancelClose(), []);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      close();
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  // The panel goes with the last task: a popover over nothing is a ghost.
  useEffect(() => {
    if (tasks.length === 0 && open) close();
  }, [tasks.length, open, close]);

  if (tasks.length === 0) return null;

  const hoverIn = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') openPanel();
  };
  const hoverOut = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse' || pinned.current) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  const sentence = tasksSentence(tasks);
  const whole = overallProgress(tasks);
  const word = compact ? null : whole === null ? pillWord(tasks) : `${Math.round(whole * 100)} %`;

  return (
    <div ref={rootRef} className="relative inline-flex" onPointerEnter={hoverIn} onPointerLeave={hoverOut}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open && pinned.current) {
            close();
            return;
          }
          pinned.current = true;
          openPanel();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={sentence}
        className={`inline-flex items-center shrink-0 whitespace-nowrap h-7 rounded-control border border-line-strong bg-paper font-mono text-2xs tracking-[0.06em] uppercase tabular-nums text-ink-soft cursor-pointer transition-colors hover:border-accent hover:text-accent-ink ${
          word ? 'gap-1.5 px-2.5' : 'justify-center w-7 px-0'
        }`}
      >
        <span className="inline-block w-[7px] h-[7px] rounded-full shrink-0 bg-accent animate-pulse" aria-hidden="true" />
        {word}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {sentence}
      </span>

      {open && (
        <div className="absolute top-full right-0 z-50 pt-2" style={{ left: offset, right: 'auto' }}>
          <div
            className="w-[min(20rem,calc(100vw-2rem))] flex flex-col gap-3 p-3 rounded-paper border border-line bg-surface shadow-paper font-mono text-2xs leading-[1.15rem] text-muted"
            role="dialog"
            aria-label="What is running"
          >
            {tasks.map((t) => (
              <div key={t.id} className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-baseline justify-between gap-3 min-w-0">
                  <span className="text-ink min-w-0 truncate" title={t.label}>
                    {t.label}
                  </span>
                  {t.progress !== null && <span className="tabular-nums shrink-0">{Math.round(t.progress * 100)} %</span>}
                </div>
                <TaskBar tasks={[t]} className="rounded-full" />
                <div className="flex items-baseline justify-between gap-3 min-w-0">
                  <span className="min-w-0 truncate text-faint">{t.detail ?? (t.progress === null ? 'no length to measure' : '')}</span>
                  {/* Drawn only where the work can really stop: a button that
                      does nothing is worse than no button. */}
                  {t.cancel && (
                    <button
                      type="button"
                      onClick={() => cancelTask(t.id)}
                      className="p-0 border-0 bg-transparent text-2xs font-semibold text-accent-ink underline underline-offset-[3px] cursor-pointer shrink-0"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
