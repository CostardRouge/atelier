import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  pillLabel,
  pillNeedsAction,
  pillText,
  type SyncRecord,
  type SyncStatus,
} from './doc-sync';
import { useIsCompact } from '../ui/use-layout-mode';

interface SyncPillProps {
  record: SyncRecord;
  /** The host, as the pill prints it. */
  sourceLabel: string;
  /** Where to sign in when the session there has ended. */
  loginUrl: string | null;
  onSaveNow: () => void;
  /** Conflict: re-push over the server's copy. */
  onKeepMine: () => void;
  /** Conflict: replace the mirror with the server's copy, dropping local edits. */
  onTakeTheirs: () => void;
  /** Gone: keep the document in this browser as a local one. */
  onKeepLocal: () => void;
  /** Gone: delete the mirror here too. */
  onDeleteHere: () => void;
}

/** The dot's colour per status — a glance before the sentence. */
const DOT: Record<SyncStatus, string> = {
  synced: 'bg-[#4f8a5b]',
  dirty: 'bg-[#c9a227]',
  saving: 'bg-[#c9a227] animate-pulse',
  offline: 'bg-faint',
  unauthenticated: 'bg-accent',
  forbidden: 'bg-[#9a3a23]',
  conflict: 'bg-[#9a3a23]',
  gone: 'bg-[#9a3a23]',
};

const linkBtn =
  'p-0 border-0 bg-transparent text-[0.72rem] font-semibold text-accent-ink underline underline-offset-[3px] cursor-pointer';

/** The panel's width, in px — the same number its `w-[min(20rem,…)]` resolves to. */
const PANEL_WIDTH = 320;

/** How close to the screen edge the panel may come. */
const EDGE = 8;

/** How long a mouse may be off the pill before a hover-opened panel closes. */
const HOVER_CLOSE_MS = 160;

/** A clock that ticks slowly, so "2 min ago" stays true without a re-render per second. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

/**
 * Where a remote document stands — one sentence, always the true one, and the
 * buttons that state calls for. It reads the same record the shell writes, so
 * every screen of a tool says the same thing.
 *
 * **It is a header pill, not a header row (2026-09-10).** The sentence used to
 * be printed in full and, being a sentence nobody controls the length of (a
 * host name, a relative time, up to three actions), it took a line of its own
 * under the navigation buttons — on a phone that is a tenth of the screen
 * spent on "saved · just now". So the pill collapses to the same 1.9rem
 * lozenge as the buttons it sits with — a coloured dot and one word — and the
 * sentence with its verbs moves into a popover, opened by a click anywhere and
 * by hover where there is a mouse.
 *
 * On a phone even the word goes, unless the state is waiting on the author:
 * `pillNeedsAction` is what keeps "Conflict" and "Sign in" spelled out at
 * every width, because a decision nobody is asked to make does not get made.
 * The full sentence is still announced — it lives in a visually hidden live
 * region, so a screen reader hears the change whether or not the panel is up.
 *
 * "Take theirs" and "Delete here" drop something that cannot be recovered, so
 * each is a two-step inside the panel — the gallery's own confirm pattern, no
 * modal.
 */
export default function SyncPill({
  record,
  sourceLabel,
  loginUrl,
  onSaveNow,
  onKeepMine,
  onTakeTheirs,
  onKeepLocal,
  onDeleteHere,
}: SyncPillProps) {
  const now = useNow(30_000);
  const compact = useIsCompact();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState<'theirs' | 'delete' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A click PINS the panel: it then survives the mouse leaving, and only
  // Escape, an outside press or another click on the pill takes it down.
  const pinned = useRef(false);
  const closeTimer = useRef<number | null>(null);

  const text = pillText(record, sourceLabel, now);
  const label = pillLabel(record.status);
  const needsAction = pillNeedsAction(record.status);
  const canSaveNow =
    record.dirtyAt !== null &&
    (record.status === 'dirty' || record.status === 'offline' || record.status === 'unauthenticated');

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
    // A half-answered "drop the edits made here?" must not be waiting behind a
    // closed panel: the question is asked again from the start next time.
    setConfirming(null);
  }, []);

  /**
   * Slide the panel back onto the screen. It hangs from the pill's left edge
   * and the pill can be anywhere — at the right of the Studio's project bar,
   * at the left of Road Trip's — while the shell clips horizontally, so an
   * uncorrected panel is simply cut off at one side or the other.
   *
   * A CLAMP, not a choice of two corners: on a 390px screen the panel is
   * wider than the room either side of a pill in the middle of a row, so
   * anchoring it right put its left edge at −87px. Measured at open time,
   * which is the only moment it matters.
   */
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

  // Escape and an outside press close it, and focus comes back to the pill —
  // the app's own popover contract (`ToolSwitcher`, `DayPicker`), no library.
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

  /** A verb was used: the state it belonged to is over, so the panel goes. */
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  // Hover is for a mouse only. A touch reports `pointerType: 'touch'` on the
  // same events and would open the panel on the way to the tap, then have the
  // tap close it again.
  const hoverIn = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') openPanel();
  };
  const hoverOut = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse' || pinned.current) return;
    cancelClose();
    // A grace period, because the gap between the pill and the panel is
    // crossed with the pointer briefly over neither.
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  const showLabel = !compact || needsAction;

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onPointerEnter={hoverIn}
      onPointerLeave={hoverOut}
    >
      {/* Same 1.9rem line, same border token and same radius as the buttons it
          shares a row with, so the row reads as one family rather than a
          status object dropped among controls. Fixed height, so nothing here
          may wrap: that is the whole point of the collapse. */}
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
        // No `title`: the browser's own tooltip would appear over the panel a
        // hover has just opened, saying the same sentence a second time.
        aria-label={text}
        className={`inline-flex items-center shrink-0 whitespace-nowrap h-[1.9rem] rounded-full border bg-paper font-mono text-[0.66rem] tracking-[0.06em] uppercase cursor-pointer transition-colors ${
          showLabel ? 'gap-1.5 px-2.5' : 'justify-center w-[1.9rem] px-0'
        } ${
          needsAction
            ? 'border-[#e3b8a9] text-[#9a3a23] hover:border-accent'
            : 'border-line-strong text-ink-soft hover:border-accent hover:text-accent-ink'
        }`}
      >
        <span
          className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 ${DOT[record.status]}`}
          aria-hidden="true"
        />
        {showLabel && label}
      </button>

      {/* The sentence is announced whether or not the panel is open — the pill
          is a summary and a live region has to carry the whole state. */}
      <span className="sr-only" role="status" aria-live="polite">
        {text}
      </span>

      {open && (
        // The offset is PADDING on the wrapper, not a margin on the panel: a
        // real gap is a strip the pointer crosses over neither element, and
        // hover would drop the panel on the way to its buttons.
        <div className="absolute top-full z-50 pt-2" style={{ left: offset }}>
          <div
            className="w-[min(20rem,calc(100vw-2rem))] flex flex-col gap-2 p-3 rounded-paper border border-line bg-surface shadow-paper font-mono text-[0.7rem] leading-[1.15rem] text-muted"
            role="dialog"
            aria-label="Where this document stands"
          >
            <span>{text}</span>

            {(canSaveNow ||
              record.status === 'unauthenticated' ||
              record.status === 'conflict' ||
              record.status === 'gone') && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {canSaveNow && (
                  <button type="button" onClick={run(onSaveNow)} className={linkBtn}>
                    Save now
                  </button>
                )}
                {record.status === 'unauthenticated' && loginUrl && (
                  <a href={loginUrl} target="_blank" rel="noreferrer" className={linkBtn}>
                    Sign in
                  </a>
                )}

                {record.status === 'conflict' &&
                  (confirming === 'theirs' ? (
                    <span className="inline-flex items-center gap-2">
                      drop the edits made here?
                      <button
                        type="button"
                        onClick={run(onTakeTheirs)}
                        className={`${linkBtn} text-[#9a3a23]`}
                      >
                        Yes, take theirs
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className={linkBtn}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" onClick={run(onKeepMine)} className={linkBtn}>
                        Keep mine
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming('theirs')}
                        className={linkBtn}
                      >
                        Take theirs
                      </button>
                    </>
                  ))}

                {record.status === 'gone' &&
                  (confirming === 'delete' ? (
                    <span className="inline-flex items-center gap-2">
                      delete it here too?
                      <button
                        type="button"
                        onClick={run(onDeleteHere)}
                        className={`${linkBtn} text-[#9a3a23]`}
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className={linkBtn}
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <>
                      <button type="button" onClick={run(onKeepLocal)} className={linkBtn}>
                        Keep here as local
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming('delete')}
                        className={linkBtn}
                      >
                        Delete here
                      </button>
                    </>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
