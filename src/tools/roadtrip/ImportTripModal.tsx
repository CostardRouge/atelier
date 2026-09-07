import { useEffect, useRef, useState } from 'react';
import { TRIP_FILE_EXTENSION } from '../../shared/roadtrip/trip-file';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../../shared/sources/source';

interface ImportTripModalProps {
  /**
   * The sources that can hold the imported trip. With ONE the picker is not
   * shown at all — the modal must not grow for a choice that does not exist.
   */
  sources: readonly SourceInfo[];
  onCancel: () => void;
  /** Chosen target in hand: the caller opens the native file dialog next. */
  onChooseFile: (targetSourceId: string) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const input =
  'font-sans text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-[1rem]';

/**
 * Where an imported trip lands used to be a `<select>` sitting in the
 * gallery header at all times, useful only during the rare import gesture.
 * Folding it into this modal — shown only when there is an actual choice —
 * gives that header space back the rest of the time.
 */
export default function ImportTripModal({ sources, onCancel, onChooseFile }: ImportTripModalProps) {
  const [target, setTarget] = useState(() =>
    sources.some((s) => s.id === DEFAULT_SOURCE_ID) ? DEFAULT_SOURCE_ID : (sources[0]?.id ?? DEFAULT_SOURCE_ID),
  );
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the modal is short-lived.
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Import a trip file"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[26rem] flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">Import a trip file</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">
            Creates a new trip from an exported {TRIP_FILE_EXTENSION} backup — it
            never overwrites one you already have.
          </p>
        </div>

        {sources.length > 1 && (
          <label className={field}>
            <span className={legend}>Keep on</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={input}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === DEFAULT_SOURCE_ID ? 'this browser (local)' : s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center justify-end gap-4 pt-1 border-t border-line">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => onChooseFile(target)}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            Choose file…
          </button>
        </div>
      </div>
    </div>
  );
}
