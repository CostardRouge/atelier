import { useEffect, useMemo, useRef, useState } from 'react';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { formatIsoDate, spanLength, todayIso } from '../../shared/roadtrip/trip-days';
import { spanProblem } from '../../shared/roadtrip/trip-types';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../../shared/sources/source';
import InfoDot from '../../shared/ui/InfoDot';
import { DateField } from '../../shared/ui/DateField';

export interface NewTrip {
  name: string;
  startDate: string;
  endDate: string;
  /** Where the trip is kept — this browser, or a connected instance. */
  sourceId: string;
}

/** A connected Winnow the modal can offer as a seed, and whether it can. */
export interface TimelineSourceOption {
  id: string;
  /** False on an instance that has no timeline yet — offered greyed, with the reason. */
  hasTimeline: boolean;
}

interface NewTripModalProps {
  /**
   * The sources that can hold a trip. With ONE the picker is not shown at all
   * — the modal must not grow for a choice that does not exist.
   */
  sources?: readonly SourceInfo[];
  onCancel: () => void;
  onSubmit: (trip: NewTrip) => void;
  /** The Winnows this browser is connected to; empty hides the seed row entirely. */
  timelineSources?: TimelineSourceOption[];
  /** Hand over to the timeline screen for that source. */
  onSeedFrom?: (sourceId: string) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const input =
  'font-sans text-base px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-base';

/**
 * Creating a trip asks what a trip IS and nothing more: a name, its two
 * dates — what every later badge counts from («day 27 / 310»), so the length
 * is echoed back live, a mistyped year being invisible as a date and obvious
 * as «3 862 days» — and, with a second source, where it is kept.
 *
 * Everything else — the cover, the road, the places, the words, starting the
 * legs over, and the dates again later — lives in ONE sheet, Trip settings
 * (`TripSettingsModal`), opened from the overview, from a piece and from the
 * gallery card (2026-10-09, the maintainer: two different sheets for one trip
 * made no sense). This one used to edit the span too; that moved there.
 */
export default function NewTripModal({
  sources = [],
  onCancel,
  onSubmit,
  timelineSources = [],
  onSeedFrom,
}: NewTripModalProps) {
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState(() =>
    sources.some((s) => s.id === DEFAULT_SOURCE_ID) ? DEFAULT_SOURCE_ID : (sources[0]?.id ?? DEFAULT_SOURCE_ID),
  );
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState(() => todayIso());
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    // Mount-only: the modal is short-lived.
  }, []);

  const problem = useMemo(() => spanProblem(startDate, endDate), [startDate, endDate]);
  const length = useMemo(() => (problem ? null : spanLength(startDate, endDate)), [problem, startDate, endDate]);
  const canSubmit = !problem && name.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit({ name, startDate, endDate, sourceId });
  }

  // Enter creates from any field — typing a date and reaching for the mouse
  // is the gesture this sheet is all about.
  useDialogKeys({ onCancel, onConfirm: canSubmit ? submit : null });

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
      <div className="w-full max-w-[34rem] max-h-[calc(var(--app-h)*0.9)] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6">
        <div>
          <h2 className="m-0 font-serif text-2xl">New trip</h2>
          <p className="m-0 mt-1 text-sm text-muted">
            All of it stays editable.{' '}
            <InfoDot about="the dates">
              <p>
                The dates are what every badge counts from — &ldquo;day 27&rdquo;, &ldquo;515 days
                ago&rdquo; are measured off them.
              </p>
              <p>Where the trip went is its legs&rsquo; business, on the calendar.</p>
            </InfoDot>
          </p>
        </div>

        {/* A connected Winnow can seed the trip from its timeline — the legs,
            the span, the places — instead of two dates typed by hand. One row,
            shown only when there is such a source, so the modal stays light. */}
        {timelineSources.length > 0 && onSeedFrom && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted">
            <span>or seed it from</span>
            {timelineSources.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!s.hasTimeline}
                title={s.hasTimeline ? `Create the trip from ${s.id}'s timeline` : `${s.id} has no timeline yet`}
                onClick={() => onSeedFrom(s.id)}
                className="px-3 py-1 inline-flex items-center border border-line-strong rounded-full bg-paper text-ink-soft cursor-pointer text-xs font-semibold hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default disabled:hover:border-line-strong disabled:hover:text-ink-soft"
              >
                {s.id}
              </button>
            ))}
          </div>
        )}

        {/* The name is renamed in place on the overview's heading — a second
            field for it here would be a second way to do one thing. */}
        {(
          <label className={field}>
            <span className={legend}>Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Australie"
              className={input}
            />
            <span className="text-2xs text-faint">
              Short — it is what a badge says over the picture.
            </span>
          </label>
        )}

        {/* One date per line on a phone: at 16px (the size that stops iOS
            zooming) two native date fields do not fit 390px side by side. */}
        <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
          <label className={field}>
            <span className={legend}>Left on</span>
            <DateField
              value={startDate}
              max={endDate || undefined}
              onChange={setStartDate}
              label="Left on"
              format={formatIsoDate}
            />
          </label>
          <label className={field}>
            <span className={legend}>Came back</span>
            <DateField
              value={endDate}
              min={startDate || undefined}
              onChange={setEndDate}
              label="Came back"
              format={formatIsoDate}
            />
          </label>
        </div>

        {/* Only when there is a choice: with this browser alone there is
            nothing to pick, and the modal must not grow for it. A remote trip
            is pushed the moment it is created — one gesture, one request. */}
        {sources.length > 1 && (
          <label className={field}>
            <span className={legend}>Keep on</span>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className={input}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === DEFAULT_SOURCE_ID ? 'this browser (local)' : s.label}
                </option>
              ))}
            </select>
            <span className="text-2xs text-faint">
              {sourceId === DEFAULT_SOURCE_ID
                ? 'Stays in this browser. Export a file to move it elsewhere.'
                : `Saved to ${sourceId} as you edit, so it resumes from another device.`}
            </span>
          </label>
        )}

        <p
          className={`m-0 text-xs ${problem ? 'text-danger' : 'text-muted'}`}
          role={problem ? 'alert' : undefined}
        >
          {problem ??
            (length === null
              ? 'Pick both dates.'
              : `${length} day${length === 1 ? '' : 's'} — badges will read “day n / ${length}”.`)}
        </p>

        {/* Pinned: the two dates push the button below the fold on a phone. */}
        <div className="sticky bottom-0 -mx-6 mt-4 px-6 pb-6 flex items-center justify-end gap-4 pt-1 border-t border-line bg-surface">
          <button
            type="button"
            onClick={onCancel}
            className="p-0 mt-4 border-0 bg-transparent text-sm text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-sm font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ink disabled:hover:border-ink"
          >
            Create trip
          </button>
        </div>
      </div>
    </div>
  );
}

