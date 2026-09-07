import { useEffect, useState } from 'react';
import { pillText, type SyncRecord, type SyncStatus } from './doc-sync';

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
 * Where a remote document stands — one sentence, always the true one, and
 * the buttons that state calls for. It reads the same record the shell
 * writes, so every screen of a tool says the same thing.
 *
 * "Take theirs" and "Delete here" drop something that cannot be recovered,
 * so each is a two-step inside the pill — the gallery's own confirm pattern,
 * no modal.
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
  const [confirming, setConfirming] = useState<'theirs' | 'delete' | null>(null);
  const text = pillText(record, sourceLabel, now);
  const canSaveNow =
    record.dirtyAt !== null &&
    (record.status === 'dirty' || record.status === 'offline' || record.status === 'unauthenticated');

  return (
    // The shape has to survive two lines. `rounded-full` on a box that grows
    // turns a status line into a fat lozenge as soon as the sentence wraps
    // (a long host name plus "Save now" is enough), so the radius is pinned
    // to half the one-line height: identical to a stadium while it fits on
    // one line, an ordinary rounded box once it does not. Same border weight
    // and same 1.9rem line as the buttons it sits with, so a header row of
    // pills reads as one family. `items-start` + the dot's offset keep the
    // dot on the FIRST line rather than floating beside the middle.
    <div
      className="inline-flex items-start gap-2 max-w-full px-3 py-[0.25rem] rounded-[0.95rem] border border-line-strong bg-paper font-mono text-[0.68rem] leading-[1.3rem] text-muted"
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-block w-[7px] h-[7px] mt-[0.4rem] rounded-full shrink-0 ${DOT[record.status]}`}
      />
      <div className="min-w-0 flex flex-wrap items-baseline gap-x-3">
        <span className="min-w-0">{text}</span>

        {canSaveNow && (
          <button type="button" onClick={onSaveNow} className={linkBtn}>
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
              <button type="button" onClick={() => { setConfirming(null); onTakeTheirs(); }} className={`${linkBtn} text-[#9a3a23]`}>
                Yes, take theirs
              </button>
              <button type="button" onClick={() => setConfirming(null)} className={linkBtn}>
                No
              </button>
            </span>
          ) : (
            <>
              <button type="button" onClick={onKeepMine} className={linkBtn}>
                Keep mine
              </button>
              <button type="button" onClick={() => setConfirming('theirs')} className={linkBtn}>
                Take theirs
              </button>
            </>
          ))}

        {record.status === 'gone' &&
          (confirming === 'delete' ? (
            <span className="inline-flex items-center gap-2">
              delete it here too?
              <button type="button" onClick={() => { setConfirming(null); onDeleteHere(); }} className={`${linkBtn} text-[#9a3a23]`}>
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirming(null)} className={linkBtn}>
                No
              </button>
            </span>
          ) : (
            <>
              <button type="button" onClick={onKeepLocal} className={linkBtn}>
                Keep here as local
              </button>
              <button type="button" onClick={() => setConfirming('delete')} className={linkBtn}>
                Delete here
              </button>
            </>
          ))}
      </div>
    </div>
  );
}
