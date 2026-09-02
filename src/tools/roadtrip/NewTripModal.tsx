import { useEffect, useMemo, useRef, useState } from 'react';
import { spanLength, todayIso } from '../../shared/roadtrip/trip-days';
import { spanProblem } from '../../shared/roadtrip/trip-types';

export interface NewTripChoices {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
}

interface NewTripModalProps {
  onCancel: () => void;
  onCreate: (choices: NewTripChoices) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const input =
  'font-sans text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-[1rem]';

/**
 * Naming a trip is naming its span: the two dates are what every later badge
 * counts from ("day 27 / 310"), so the length is echoed back live — a
 * mistyped year is invisible as a date and obvious as "3 862 days".
 */
export default function NewTripModal({ onCancel, onCreate }: NewTripModalProps) {
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(() => todayIso());
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Mount-only: the modal is short-lived.
  }, []);

  const problem = useMemo(
    () => spanProblem(startDate, endDate),
    [startDate, endDate],
  );
  const length = useMemo(
    () => (problem ? null : spanLength(startDate, endDate)),
    [problem, startDate, endDate],
  );
  const canCreate = !problem && name.trim().length > 0;

  function submit() {
    if (!canCreate) return;
    onCreate({ name, destination, startDate, endDate });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="New trip"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[30rem] max-h-[90dvh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">New trip</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">
            The dates are what every badge counts from. All of it stays editable.
          </p>
        </div>

        <label className={field}>
          <span className={legend}>Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="Australie"
            className={input}
          />
          <span className="text-[0.7rem] text-faint">
            Short — it is what a badge says over the picture.
          </span>
        </label>

        <label className={field}>
          <span className={legend}>Destination</span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="Australia — Perth to Cairns"
            className={input}
          />
        </label>

        {/* One date per line on a phone: at 16px (the size that stops iOS
            zooming) two native date fields do not fit 390px side by side. */}
        <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
          <label className={field}>
            <span className={legend}>Left on</span>
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className={input}
            />
          </label>
          <label className={field}>
            <span className={legend}>Came back</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className={input}
            />
          </label>
        </div>

        <p
          className={`m-0 text-[0.78rem] ${problem ? 'text-[#9a3a23]' : 'text-muted'}`}
          role={problem ? 'alert' : undefined}
        >
          {problem ??
            (length === null
              ? 'Pick both dates.'
              : `${length} day${length === 1 ? '' : 's'} — badges will read “day n / ${length}”.`)}
        </p>

        {/* Pinned: the two dates push Create below the fold on a phone. */}
        <div className="sticky bottom-0 -mx-6 mt-4 px-6 pb-6 flex items-center justify-end gap-4 pt-1 border-t border-line bg-surface">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canCreate}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ink disabled:hover:border-ink"
          >
            Create trip
          </button>
        </div>
      </div>
    </div>
  );
}
