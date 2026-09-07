import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteThumbs } from '../../shared/roadtrip/trip-store';
import { applyTripDetails } from '../../shared/roadtrip/trip-edit';
import { dayStageActions } from '../../shared/roadtrip/stage-edit';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import { enumerateDays, formatIsoDate, isWithin, type IsoDate } from '../../shared/roadtrip/trip-days';
import { stageAt, tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { usePublishMediaScope, type MediaScope } from '../../shared/sources/media-scope';
import type { TripDoc, TripPost, TripStage } from '../../shared/roadtrip/trip-types';
import DayHeatmap, { type DayMenuItem } from './DayHeatmap';
import DayPanel from './DayPanel';
import StagesPanel from './StagesPanel';
import TripDetailsModal, { type TripDetails } from './TripDetailsModal';

interface TripOverviewProps {
  trip: TripDoc;
  /** The day the route names; null falls back to the first day of the trip. */
  selectedDate: IsoDate | null;
  onSelectDate: (date: IsoDate) => void;
  onShowTrips: () => void;
  onChange: (trip: TripDoc) => void;
  /** Open a piece's hook composer. */
  onOpenPost: (post: TripPost) => void;
  /** What the shell wants in the header row — the sync pill of a remote trip. */
  headerExtra?: ReactNode;
  /** Connected Winnows with a timeline, offered on the stages panel. */
  timelineSources?: string[];
  onCompleteFrom?: (sourceId: string) => void;
}

const barPill =
  'inline-flex items-center h-[1.9rem] px-3 rounded-full border whitespace-nowrap';

/**
 * The trip's name, renamed in place.
 *
 * A trip is named once in the creation modal and then lived with for months —
 * a typo, a working title ("Australia") that wants to become the real one, or
 * a badge that reads better with a shorter word, all need a way back. It sits
 * on the heading rather than in the trip sheet because that sheet is reached
 * from a PIECE: a trip that has no piece yet could never be renamed from it.
 *
 * An emptied field gives the old name back rather than saving a blank — the
 * same rule the badge's text overrides follow, and a nameless trip is a row of
 * nothing in the gallery.
 */
function TripTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) inputRef.current?.select();
    // Select on entry only, so typing replaces a name rather than appending.
  }, [editing]);

  function commit() {
    const next = (draft ?? '').trim();
    if (next && next !== name) onRename(next);
    setDraft(null);
  }

  if (draft !== null) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Trip name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className="w-full max-w-[22rem] font-serif text-[1.5rem] leading-tight px-1.5 py-0.5 -mx-1.5 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent max-[560px]:text-[1.15rem]"
      />
    );
  }

  return (
    <h1 className="m-0 font-serif text-[1.5rem] leading-tight">
      <button
        type="button"
        onClick={() => setDraft(name)}
        title="Rename the trip"
        className="p-0 border-0 bg-transparent font-serif text-[1.5rem] leading-tight text-ink text-left cursor-text hover:text-accent-ink"
      >
        {name}
      </button>
    </h1>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[1.35rem] tabular-nums leading-none">{value}</span>
      <span className="font-mono text-[0.6rem] tracking-[0.12em] uppercase text-muted mt-1">
        {label}
      </span>
    </div>
  );
}

/**
 * The trip seen whole: the counts, the grid of its days, and whichever day is
 * open underneath. The grid is the reason the view exists — it answers "what
 * have I never told" at a glance, which is the question a year-old trip and
 * thousands of photos make impossible to answer from memory.
 */
export default function TripOverview({
  trip,
  selectedDate,
  onSelectDate,
  onShowTrips,
  onChange,
  onOpenPost,
  headerExtra,
  timelineSources,
  onCompleteFrom,
}: TripOverviewProps) {
  const coverage = useMemo(() => tripCoverage(trip), [trip]);
  // The day lives in the route, so coming back from a piece lands on the day
  // you were working on rather than on the first day of a 300-day trip.
  const selected = selectedDate ?? coverage.days[0]?.date ?? null;

  const selectedCell = useMemo(
    () => coverage.days.find((d) => d.date === selected) ?? null,
    [coverage.days, selected],
  );

  // The selected day is what the Library's Winnow tab lists — so the pictures
  // of a day can be looked at before a piece exists for it.
  const mediaScope = useMemo<MediaScope | null>(
    () =>
      selected
        ? {
            from: selected,
            to: selected,
            label: formatIsoDate(selected),
            publisher: 'Road Trip',
            // Nothing here is waiting for a picture: looking at the day's
            // media is the point, so a click should show it large.
            intent: 'browse',
          }
        : null,
    [selected],
  );
  usePublishMediaScope(mediaScope);

  const mutate = useCallback(
    (posts: TripPost[]) => onChange({ ...trip, posts, updatedAt: Date.now() }),
    [trip, onChange],
  );

  const rename = useCallback(
    (name: string) => onChange({ ...trip, name, updatedAt: Date.now() }),
    [trip, onChange],
  );

  const setStages = useCallback(
    (stages: TripStage[]) => onChange({ ...trip, stages, updatedAt: Date.now() }),
    [trip, onChange],
  );

  // The leg open under the ruler. It starts on the leg covering the open day
  // and follows every day clicked on the calendar that a leg covers — the
  // calendar is the other way into a stage — while a click on an uncovered
  // day leaves it as it was rather than closing what was being edited.
  const [stageId, setStageId] = useState<string | null>(
    () => (selected ? (stageAt(trip, selected)?.id ?? null) : null),
  );
  const selectedStageId = trip.stages.some((s) => s.id === stageId) ? stageId : null;

  const selectDate = useCallback(
    (date: IsoDate) => {
      onSelectDate(date);
      const covering = stageAt(trip, date);
      if (covering) setStageId(covering.id);
    },
    [trip, onSelectDate],
  );

  // Opening a leg goes to the day it began, and says WHICH leg rather than
  // deriving one from that day: on a travel day two legs overlap and
  // `stageAt` answers with the later one, which is not the one clicked.
  const openStage = useCallback(
    (stage: TripStage) => {
      setStageId(stage.id);
      onSelectDate(stage.startDate);
    },
    [onSelectDate],
  );

  // Each day's tint is its stage's — the LAST covering stage, as `stageAt`
  // resolves it, so a travel day wears the leg it ended in.
  const tints = useMemo(() => {
    const map = new Map<IsoDate, string>();
    trip.stages.forEach((stage, index) => {
      for (const day of enumerateDays(stage.startDate, stage.endDate)) {
        if (isWithin(trip.startDate, trip.endDate, day)) map.set(day, stageTint(index));
      }
    });
    return map;
  }, [trip]);

  const menuFor = useCallback(
    (date: IsoDate): DayMenuItem[] =>
      dayStageActions(trip, date).map((action) => ({
        label: action.label,
        run: () => {
          const result = action.apply(trip);
          setStages(result.stages);
          setStageId(result.selectedId);
        },
      })),
    [trip, setStages],
  );

  const untold = coverage.totalDays - coverage.toldDays;

  // The dates-and-route sheet, the creation modal reopened on this trip.
  const [editingDetails, setEditingDetails] = useState(false);
  const saveDetails = useCallback(
    (details: TripDetails) => {
      setEditingDetails(false);
      const next = applyTripDetails(trip, {
        startDate: details.startDate,
        endDate: details.endDate,
        from: details.from,
        to: details.to,
      });
      onChange({ ...next, updatedAt: Date.now() });
      // The open day may no longer be in the trip: the route says where you
      // are, so it has to follow rather than leave the panel on a day the
      // calendar no longer draws.
      if (selected && !isWithin(next.startDate, next.endDate, selected)) {
        onSelectDate(next.startDate);
      }
    },
    [trip, onChange, onSelectDate, selected],
  );

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-5 overflow-auto"
      aria-label={`${trip.name} overview`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onShowTrips}
          className={`${barPill} border-line-strong bg-paper text-[0.78rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink`}
        >
          ← Trips
        </button>
        <div className="min-w-0">
          <TripTitle name={trip.name} onRename={rename} />
          {/* The subtitle is the way back into the two facts that were only
              askable at creation. Same sheet, so there is one place where a
              trip's dates and route are said. */}
          <button
            type="button"
            onClick={() => setEditingDetails(true)}
            title="Change the trip's dates and route"
            className="p-0 border-0 bg-transparent font-mono text-[0.72rem] text-muted text-left cursor-pointer hover:text-accent-ink hover:underline underline-offset-[3px]"
          >
            {trip.destination && <>{trip.destination} · </>}
            {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
          </button>
        </div>
        {headerExtra && (
          <>
            <span className="flex-1" />
            {headerExtra}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-4 bg-surface border border-line rounded-paper-lg p-5">
        <Stat value={String(coverage.totalDays)} label="days on the road" />
        <Stat
          value={`${coverage.toldDays}`}
          label={`days told · ${untold} left`}
        />
        <Stat value={String(coverage.posts)} label="pieces" />
        <Stat value={String(coverage.publishedPosts)} label="published" />
        {coverage.longestGap && (
          <Stat
            value={String(coverage.longestGap.length)}
            label="longest silence"
          />
        )}
      </div>

      <div className="bg-surface border border-line rounded-paper-lg p-5">
        <DayHeatmap
          startDate={trip.startDate}
          endDate={trip.endDate}
          days={coverage.days}
          selected={selected}
          onSelect={selectDate}
          tintOf={(date) => tints.get(date) ?? null}
          menuFor={menuFor}
        />
      </div>

      {coverage.longestGap && (
        <p className="m-0 text-[0.8rem] text-muted">
          The longest stretch nothing has been told from runs{' '}
          <button
            type="button"
            onClick={() => selectDate(coverage.longestGap!.start)}
            className="p-0 border-0 bg-transparent text-accent-ink underline underline-offset-[3px] cursor-pointer font-semibold"
          >
            {formatIsoDate(coverage.longestGap.start)} →{' '}
            {formatIsoDate(coverage.longestGap.end)}
          </button>{' '}
          — {coverage.longestGap.length} days.
        </p>
      )}

      <StagesPanel
        trip={trip}
        selectedId={selectedStageId}
        cursorDate={selected}
        onSelect={setStageId}
        onOpenStage={openStage}
        onScrub={selectDate}
        onChange={setStages}
        timelineSources={timelineSources}
        onCompleteFrom={onCompleteFrom}
      />

      {selected && (
        <DayPanel
          trip={trip}
          date={selected}
          cell={selectedCell}
          onAddPost={(post) => mutate([...trip.posts, post])}
          onUpdatePost={(post) =>
            mutate(trip.posts.map((p) => (p.id === post.id ? post : p)))
          }
          onDeletePost={(id) => {
            void deleteThumbs([id]);
            mutate(trip.posts.filter((p) => p.id !== id));
          }}
          onOpenPost={onOpenPost}
        />
      )}

      {editingDetails && (
        <TripDetailsModal
          trip={trip}
          onCancel={() => setEditingDetails(false)}
          onSubmit={saveDetails}
        />
      )}
    </section>
  );
}
