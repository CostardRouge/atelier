import { useEffect, useMemo, useRef, useState } from 'react';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
import { hasImpact, spanImpact } from '../../shared/roadtrip/trip-edit';
import { formatIsoDate, spanLength, todayIso } from '../../shared/roadtrip/trip-days';
import {
  defaultTripCover,
  spanProblem,
  type TripCover,
  type TripDoc,
} from '../../shared/roadtrip/trip-types';
import { prunePins } from '../../shared/roadtrip/trip-cover';
import CoverPanel from './CoverPanel';
import RoadSettingsPanel from './RoadSettingsPanel';
import { DEFAULT_ROAD_DETAIL, DEFAULT_ROAD_MODE, type TripRoad } from '../../shared/roadtrip/road-track';
import { DEFAULT_SOURCE_ID, type SourceInfo } from '../../shared/sources/source';
import InfoDot from '../../shared/ui/InfoDot';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import { DateField } from '../../shared/ui/DateField';
import { downloadBlob } from '../../shared/media/save';
import { serializeTripFile, toTripFile, tripFileName } from '../../shared/roadtrip/trip-file';
import {
  canReset,
  resetStages,
  stageResetCounts,
  type StageReset,
  type StageResetCounts,
} from '../../shared/roadtrip/stage-reset';

export interface TripDetails {
  name: string;
  startDate: string;
  endDate: string;
  /** Where the trip is kept — this browser, or a connected instance. */
  sourceId: string;
  /** How the trip shows itself in the gallery. Editing only. */
  cover: TripCover;
  /** The trip's road as this sheet leaves it (`road-track.ts`). Editing only. */
  road?: TripRoad | null;
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
  /**
   * Editing only: write the trip with its legs started over
   * (`stage-reset.ts`). Absent hides the Start over row.
   */
  onReset?: (trip: TripDoc) => void;
}

const field = 'flex flex-col gap-1.5';
const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';
const input =
  'font-sans text-base px-3.5 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-base';

/**
 * Naming a trip is naming its span: the two dates are what every later badge
 * counts from ("day 27 / 310"), so the length is echoed back live — a
 * mistyped year is invisible as a date and obvious as "3 862 days".
 *
 * It asks for the dates and nothing else. It used to ask for the route too —
 * a From and a To that seeded one leg over the whole trip — and that is gone
 * (2026-09-22, the maintainer): a trip's places belong to its legs, which are
 * drawn on the calendar once the trip exists, and a leg spanning 345 days is
 * not a head start on that work. A form must not ask what the tool is about
 * to ask again, better.
 *
 * The SAME sheet edits the span afterwards (`trip`), rather than a second
 * screen asking the same question in a different order: a mistyped year or a
 * trip that turned out to run three days longer are ordinary, and neither was
 * reachable once the trip existed. What editing adds is the consequences, said
 * before they happen — shrinking a span trims the legs it still covers, drops
 * the ones it no longer reaches, and can leave a piece outside the calendar.
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
  onReset,
}: TripDetailsModalProps) {
  const editing = trip !== undefined;
  // The width of a Start over waiting on its confirmation.
  const [resetting, setResetting] = useState<StageReset | null>(null);
  const resetCounts = useMemo(() => (trip ? stageResetCounts(trip) : null), [trip]);

  const [name, setName] = useState(trip?.name ?? '');
  const [cover, setCover] = useState<TripCover>(() => trip?.cover ?? defaultTripCover());
  // The road's reading, a draft like the cover until Save.
  const [road, setRoad] = useState<TripRoad | null>(trip?.road ?? null);
  const [sourceId, setSourceId] = useState(() =>
    sources.some((s) => s.id === DEFAULT_SOURCE_ID) ? DEFAULT_SOURCE_ID : (sources[0]?.id ?? DEFAULT_SOURCE_ID),
  );
  const [startDate, setStartDate] = useState(trip?.startDate ?? '');
  const [endDate, setEndDate] = useState(() => trip?.endDate ?? todayIso());
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
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

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      name,
      startDate,
      endDate,
      sourceId,
      cover: trip ? prunePins(trip, cover) : cover,
      ...(trip ? { road } : {}),
    });
  }

  // Enter saves from any field — the dates are the reason: typing one and
  // reaching for the mouse is the gesture this sheet is all about.
  // While a Start over asks its question, the keys are the question's: an
  // Escape must close the question, never the sheet behind it too.
  useDialogKeys({
    onCancel: resetting ? undefined : onCancel,
    onConfirm: canSubmit && !resetting ? submit : null,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Trip dates' : 'New trip'}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[34rem] max-h-[calc(var(--app-h)*0.9)] overflow-auto flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper px-6 pt-6">
        <div>
          <h2 className="m-0 font-serif text-2xl">{editing ? 'Trip dates' : 'New trip'}</h2>
          <p className="m-0 mt-1 text-sm text-muted">
            All of it stays editable.{' '}
            <InfoDot about="the dates">
              <p>
                The dates are what every badge counts from — &ldquo;day 27&rdquo;, &ldquo;515 days
                ago&rdquo; are measured off them.
              </p>
              {editing && <p>Legs follow them; pieces are never moved.</p>}
              <p>Where the trip went is its legs&rsquo; business, on the calendar.</p>
            </InfoDot>
          </p>
        </div>

        {/* A connected Winnow can seed the trip from its timeline — the legs,
            the span, the places — instead of two dates typed by hand. One row,
            shown only when there is such a source, so the modal stays light. */}
        {!editing && timelineSources.length > 0 && onSeedFrom && (
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

        {/* Said BEFORE saving, never after: a trip told over a year must not
            lose a leg silently. Pieces are only hidden, never deleted. */}
        {impact && (
          <p
            className="m-0 px-3.5 py-2.5 border border-accent bg-accent-wash rounded-paper text-xs text-accent-ink"
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

        {/* The cover is a property of the TRIP, like its name and its dates, so
            it is settled in the sheet that holds them — the maintainer's own
            call. It stays reachable from the gallery card too (`TripCoverModal`
            over the same panel): a cover is looked at there, and a layout that
            draws no picture would otherwise have nowhere to be undone from.
            Creation does not offer it: a trip with no piece has nothing to show
            yet, and a form must not ask for what cannot be answered. */}
        {editing && trip && (
          <div className={field}>
            <span className={legend}>Cover</span>
            <CoverPanel trip={trip} value={cover} onChange={setCover} />
          </div>
        )}

        {/* The road the openers drive (`TripDoc.road`): a property of the trip
            like its cover, so a draft here too, written on Save. */}
        {editing && trip && (
          <div className={field}>
            <span className={legend}>Road</span>
            <RoadSettingsPanel
              road={road}
              mode={road?.mode ?? DEFAULT_ROAD_MODE}
              detail={road?.detail ?? DEFAULT_ROAD_DETAIL}
              onMode={(mode) => setRoad((r) => (r ? { ...r, mode } : r))}
              onDetail={(detail) => setRoad((r) => (r ? { ...r, detail } : r))}
              onForget={() => setRoad(null)}
            />
          </div>
        )}

        {/* Starting the legs over (2026-10-09, the maintainer: after a Deduce
            run on wrong days, forty legs deleted one by one). A verb is drawn
            only when it has something to do, and each asks first, with its
            counts; the trip's undo takes it back in one step. It writes the
            STORED trip, not this sheet's draft dates. */}
        {editing && trip && onReset && resetCounts && (
          <StartOver
            counts={resetCounts}
            onPick={setResetting}
          />
        )}

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
            {editing ? 'Save' : 'Create trip'}
          </button>
        </div>
      </div>
      {resetting && trip && onReset && resetCounts && (
        <ConfirmDialog
          title={RESET_WORDS[resetting].question}
          confirmLabel={RESET_WORDS[resetting].verb}
          danger
          onCancel={() => setResetting(null)}
          onConfirm={() => {
            const what = resetting;
            setResetting(null);
            onReset(resetStages(trip, what));
          }}
        >
          <p>{RESET_WORDS[resetting].lost(resetCounts)}</p>
          <p className="mt-2">
            Pieces, dates and the state codes stay; ⌘Z takes it back.{' '}
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  new Blob([serializeTripFile(toTripFile(trip))], { type: 'application/json' }),
                  tripFileName(trip.name),
                )
              }
              className="p-0 border-0 bg-transparent text-sm text-accent-ink underline underline-offset-[3px] cursor-pointer"
            >
              Back up the trip first
            </button>
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What each width asks, does and loses — said with the trip's own counts. */
const RESET_WORDS: Record<StageReset, { label: (c: StageResetCounts) => string; question: string; verb: string; lost: (c: StageResetCounts) => string }> = {
  deduced: {
    label: (c) => `Remove what Deduce added (${c.deduced})`,
    question: 'Remove the legs Deduce added?',
    verb: 'Remove',
    lost: (c) => `${plural(c.deduced, 'leg')} written by Deduce go, with their places. The legs you made yourself stay as they are.`,
  },
  places: {
    label: (c) => `Clear the places (${c.places})`,
    question: 'Clear every placed place?',
    verb: 'Clear the places',
    lost: (c) =>
      `${plural(c.places, 'place')}${c.located ? `, ${c.located} of them on the map,` : ''} leave the trip's ${plural(c.stages, 'leg')}. The legs keep their dates and names, ready to be placed again.`,
  },
  stages: {
    label: (c) => `Remove every leg (${c.stages})`,
    question: 'Start the legs from zero?',
    verb: 'Remove every leg',
    lost: (c) =>
      `${plural(c.stages, 'leg')} and their ${plural(c.places, 'place')} go. The calendar is left bare for a new Deduce, a timeline import or legs drawn by hand.`,
  },
};

/** The row of verbs; the question is the sheet's, so its keys can stand down. */
function StartOver({ counts, onPick }: { counts: StageResetCounts; onPick: (what: StageReset) => void }) {
  // Removing what Deduce added IS removing every leg when Deduce wrote them
  // all — one verb, not two saying the same thing.
  const offered = (['deduced', 'places', 'stages'] as const).filter(
    (w) => canReset(counts, w) && !(w === 'deduced' && counts.deduced === counts.stages),
  );
  if (!offered.length) return null;
  return (
    <div className={field}>
      <span className={legend}>
        Start over{' '}
        <InfoDot about="starting over">
          <p>Clears what the legs hold, so a Deduce or a timeline import can start from a clean calendar.</p>
          <p>Pieces, the trip's dates and its state codes are never touched, and ⌘Z takes it back.</p>
        </InfoDot>
      </span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {offered.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => onPick(w)}
            className="p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-danger"
          >
            {RESET_WORDS[w].label(counts)}
          </button>
        ))}
      </div>
    </div>
  );
}
