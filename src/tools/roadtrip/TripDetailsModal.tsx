import { useEffect, useMemo, useRef, useState } from 'react';
import PlaceSearchField from '../../shared/map/PlaceSearchField';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { PLACE_ARROW, tripRouteEnds } from '../../shared/roadtrip/trip-places';
import { hasImpact, spanImpact } from '../../shared/roadtrip/trip-edit';
import { spanLength, todayIso } from '../../shared/roadtrip/trip-days';
import {
  createTripPlace,
  spanProblem,
  type TripDoc,
  type TripPlace,
} from '../../shared/roadtrip/trip-types';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../../shared/sources/source';

export interface TripDetails {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  /** Where the trip set out from — an empty name means it names none. */
  from: TripPlace;
  /** Where it ended. */
  to: TripPlace;
  /** Where the trip is kept — this browser, or a connected instance. */
  sourceId: string;
}

/** A connected Winnow the modal can offer as a seed, and whether it can. */
export interface TimelineSourceOption {
  id: string;
  /** False on an instance that has no timeline yet — offered greyed, with the reason. */
  hasTimeline: boolean;
}

interface TripDetailsModalProps {
  /**
   * The trip being edited. Absent creates one — the same four fields, since
   * they are the same four facts.
   */
  trip?: TripDoc;
  /**
   * The sources that can hold a trip. With ONE the picker is not shown at all
   * — the modal must not grow for a choice that does not exist. Creation only.
   */
  sources?: readonly SourceInfo[];
  onCancel: () => void;
  onSubmit: (details: TripDetails) => void;
  /** The Winnows this browser is connected to; empty hides the seed row entirely. */
  timelineSources?: TimelineSourceOption[];
  /** Hand over to the timeline screen for that source. */
  onSeedFrom?: (sourceId: string) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';
const input =
  'font-sans text-[0.95rem] px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-[1rem]';

/**
 * Naming a trip is naming its span: the two dates are what every later badge
 * counts from ("day 27 / 310"), so the length is echoed back live — a
 * mistyped year is invisible as a date and obvious as "3 862 days".
 *
 * The old free-text "Destination" ("Australia — Perth to Cairns") is two fields
 * now, From and To, because a route typed as one string is a route nothing can
 * read. They cost no height — one row, like the dates below them — and they
 * seed the trip's first stage, so a badge can name a place from day one instead
 * of waiting for someone to open the stages panel. Left empty they seed
 * nothing, and the trip behaves exactly as trips did before places existed.
 *
 * The SAME sheet edits those four facts afterwards (`trip`), rather than a
 * second screen asking the same questions in a different order: a mistyped
 * year, a trip that turned out to run three days longer, or a route entered
 * before the drive was done are all ordinary, and none of them was reachable
 * once the trip existed. What editing adds is the consequences, said before
 * they happen — shrinking a span trims the legs it still covers, drops the
 * ones it no longer reaches, and can leave a piece outside the calendar.
 * Nothing about a piece is ever touched (`trip-edit.ts`).
 *
 * What editing deliberately does NOT show: the name (renamed in place on the
 * overview's own heading, and two ways to rename one thing on one screen is
 * clutter) and where the trip is kept (a move is the gallery's verb, and a
 * remote trip's pill is what says where it stands).
 */
export default function TripDetailsModal({
  trip,
  sources = [],
  onCancel,
  onSubmit,
  timelineSources = [],
  onSeedFrom,
}: TripDetailsModalProps) {
  const editing = trip !== undefined;
  // The ends the trip already names, as the ROUTE derives them — a trip
  // naming one place is its own start and end, so the "To" field starts empty
  // rather than repeating it (`setTripRoute` then adds a place of its own).
  const ends = useMemo(() => (trip ? tripRouteEnds(trip) : null), [trip]);

  const [name, setName] = useState(trip?.name ?? '');
  const [sourceId, setSourceId] = useState(() =>
    sources.some((s) => s.id === DEFAULT_SOURCE_ID) ? DEFAULT_SOURCE_ID : (sources[0]?.id ?? DEFAULT_SOURCE_ID),
  );
  const [from, setFrom] = useState<TripPlace>(() => ends?.from ?? createTripPlace());
  const [to, setTo] = useState<TripPlace>(() =>
    ends?.to && ends.to.id !== ends.from?.id ? ends.to : createTripPlace(),
  );
  const [startDate, setStartDate] = useState(trip?.startDate ?? '');
  const [endDate, setEndDate] = useState(() => trip?.endDate ?? todayIso());
  const nameRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (nameRef.current ?? startRef.current)?.focus();
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
  const canSubmit = !problem && (editing || name.trim().length > 0);

  // What the new span would do to the legs and the pieces already in the trip.
  // Only when it actually moved: the normal case has nothing to say.
  const impact = useMemo(() => {
    if (!trip || problem) return null;
    if (startDate === trip.startDate && endDate === trip.endDate) return null;
    const next = spanImpact(trip, startDate, endDate);
    return hasImpact(next) ? next : null;
  }, [trip, problem, startDate, endDate]);

  // The prose subtitle the overview header shows. Composed from the two ends —
  // exactly the snapshot the free-text field used to hold.
  const destination = useMemo(
    () => [from.name.trim(), to.name.trim()].filter(Boolean).join(` ${PLACE_ARROW} `),
    [from.name, to.name],
  );

  function submit() {
    if (!canSubmit) return;
    onSubmit({ name, destination, startDate, endDate, from, to, sourceId });
  }

  // Enter saves from any field — the dates are the reason: typing one and
  // reaching for the mouse is the gesture this sheet is all about.
  useDialogKeys({ onCancel, onConfirm: canSubmit ? submit : null });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Trip dates and route' : 'New trip'}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[30rem] max-h-[90dvh] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">
            {editing ? 'Dates and route' : 'New trip'}
          </h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">
            {editing
              ? 'The dates are what every badge counts from. Legs follow them; pieces are never moved.'
              : 'The dates are what every badge counts from. All of it stays editable.'}
          </p>
        </div>

        {/* A connected Winnow can seed the trip from its timeline — the legs,
            the span, the places — instead of two dates typed by hand. One row,
            shown only when there is such a source, so the modal stays light. */}
        {!editing && timelineSources.length > 0 && onSeedFrom && (
          <div className="flex items-center gap-2 flex-wrap text-[0.78rem] text-muted">
            <span>or seed it from</span>
            {timelineSources.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!s.hasTimeline}
                title={s.hasTimeline ? `Create the trip from ${s.id}'s timeline` : `${s.id} has no timeline yet`}
                onClick={() => onSeedFrom(s.id)}
                className="px-3 py-1 inline-flex items-center border border-line-strong rounded-full bg-paper text-ink-soft cursor-pointer text-[0.76rem] font-semibold hover:border-accent hover:text-accent-ink disabled:opacity-40 disabled:cursor-default disabled:hover:border-line-strong disabled:hover:text-ink-soft"
              >
                {s.id}
              </button>
            ))}
          </div>
        )}

        {/* The name is renamed in place on the overview's heading — a second
            field for it here would be a second way to do one thing. */}
        {!editing && (
          <label className={field}>
            <span className={legend}>Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Australie"
              className={input}
            />
            <span className="text-[0.7rem] text-faint">
              Short — it is what a badge says over the picture.
            </span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className={field}>
            <span className={legend}>From</span>
            <PlaceSearchField
              value={from.name}
              onChange={(next) => setFrom((place) => ({ ...place, name: next }))}
              onPick={(result) =>
                setFrom((place) => ({
                  ...place,
                  name: result.name,
                  region: result.region,
                  coords: { lat: result.lat, lon: result.lon },
                }))
              }
              placeholder="Perth"
              label="Left from"
              inputClassName={input}
            />
          </div>
          <div className={field}>
            <span className={legend}>To</span>
            <PlaceSearchField
              value={to.name}
              onChange={(next) => setTo((place) => ({ ...place, name: next }))}
              onPick={(result) =>
                setTo((place) => ({
                  ...place,
                  name: result.name,
                  region: result.region,
                  coords: { lat: result.lat, lon: result.lon },
                }))
              }
              placeholder="Cairns"
              label="Ended at"
              inputClassName={input}
            />
          </div>
        </div>

        {editing && (
          <p className="m-0 -mt-2 text-[0.7rem] text-faint">
            The two ends of the trip. They are the first and last places of its
            legs — editing one here edits it there, and the legs themselves are
            on the ruler under the calendar.
          </p>
        )}

        {/* One date per line on a phone: at 16px (the size that stops iOS
            zooming) two native date fields do not fit 390px side by side. */}
        <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
          <label className={field}>
            <span className={legend}>Left on</span>
            <input
              ref={startRef}
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

        {/* Only when there is a choice: with this browser alone there is
            nothing to pick, and the modal must not grow for it. A remote trip
            is pushed the moment it is created — one gesture, one request. */}
        {!editing && sources.length > 1 && (
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
            <span className="text-[0.7rem] text-faint">
              {sourceId === DEFAULT_SOURCE_ID
                ? 'Stays in this browser. Export a file to move it elsewhere.'
                : `Saved to ${sourceId} as you edit, so it resumes from another device.`}
            </span>
          </label>
        )}

        <p
          className={`m-0 text-[0.78rem] ${problem ? 'text-[#9a3a23]' : 'text-muted'}`}
          role={problem ? 'alert' : undefined}
        >
          {problem ??
            (length === null
              ? 'Pick both dates.'
              : `${length} day${length === 1 ? '' : 's'} — badges will read “day n / ${length}”.`)}
        </p>

        {/* Said BEFORE saving, never after: a trip told over a year must not
            lose a leg silently. Pieces are only hidden, never deleted. */}
        {impact && (
          <p
            className="m-0 px-3.5 py-2.5 border border-accent bg-accent-wash rounded-paper text-[0.78rem] text-accent-ink"
            role="status"
          >
            {[
              impact.droppedStages > 0 &&
                `${impact.droppedStages} leg${impact.droppedStages === 1 ? '' : 's'} fall${impact.droppedStages === 1 ? 's' : ''} outside these dates and will be removed`,
              impact.trimmedStages > 0 &&
                `${impact.trimmedStages} leg${impact.trimmedStages === 1 ? '' : 's'} will be trimmed to fit`,
              impact.strandedPosts > 0 &&
                `${impact.strandedPosts} piece${impact.strandedPosts === 1 ? '' : 's'} would sit outside the trip — kept, but no longer on the calendar`,
            ]
              .filter(Boolean)
              .join(' · ')}
            .
          </p>
        )}

        {/* Pinned: the two dates push the button below the fold on a phone. */}
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
            disabled={!canSubmit}
            className="mt-4 px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-ink disabled:hover:border-ink"
          >
            {editing ? 'Save' : 'Create trip'}
          </button>
        </div>
      </div>
    </div>
  );
}
