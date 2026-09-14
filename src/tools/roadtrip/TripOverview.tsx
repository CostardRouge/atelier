import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteThumbs } from '../../shared/roadtrip/trip-store';
import { applyTripDetails } from '../../shared/roadtrip/trip-edit';
import { dayStageActions } from '../../shared/roadtrip/stage-edit';
import { rulerBars, stageTint } from '../../shared/roadtrip/stage-ruler';
import {
  enumerateDays,
  formatIsoDate,
  isShortTrip,
  isWithin,
  type IsoDate,
} from '../../shared/roadtrip/trip-days';
import { stageAt, stageDayNumber, tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import {
  usePublishMediaActions,
  usePublishMediaScope,
  type MediaActions,
  type MediaScope,
} from '../../shared/sources/media-scope';
import {
  POST_KINDS,
  createTripPost,
  type PostKind,
  type TripDoc,
  type TripPost,
  type TripStage,
} from '../../shared/roadtrip/trip-types';
import DayHeatmap, { levelOf, type DayMenuItem, type DayStage, type HeatmapLeg } from './DayHeatmap';
import DayPanel from './DayPanel';
import StagesPanel from './StagesPanel';
import TripDetailsModal, { type TripDetails } from './TripDetailsModal';
import PageBar from '../../shared/ui/PageBar';
import { pageScroll } from '../../shared/ui/page-scroll';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { Icons } from '../../shared/ui/icons';
import Button from '../../shared/ui/Button';
import ShortDayStrip from './ShortDayStrip';
import { defaultLoupe, loupeContaining, moveLoupe, type Loupe } from '../../shared/roadtrip/loupe';
import LoupeBrush from './LoupeBrush';

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
        /* Exactly the pills' height, or the row centres a taller field
           against them and pushes the back button down — the whole point of
           the bar is that it does not move. */
        className="w-full min-w-0 max-w-[28rem] font-serif text-2xl leading-tight px-1.5 py-0.5 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent"
      />
    );
  }

  return (
    <h1 className="m-0 min-w-0 max-w-[28rem]">
      <button
        type="button"
        onClick={() => setDraft(name)}
        title="Rename the trip"
        className="w-full p-0 border-0 bg-transparent font-serif text-2xl leading-tight text-ink text-left truncate cursor-text hover:text-accent-ink"
      >
        {name}
      </button>
    </h1>
  );
}

/**
 * One figure of the heading: the number in the mono face, the word under it.
 * The five-count strip and the "longest stretch" sentence this replaces were
 * the top third of the screen before the calendar; three figures beside the
 * name say the same at a glance, and the silence is a link to its first day.
 */
function Figure({
  value,
  label,
  tone = 'ink',
  onClick,
  title,
}: {
  value: ReactNode;
  label: string;
  tone?: 'ink' | 'accent';
  onClick?: () => void;
  title?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={`flex flex-col items-end gap-0.5 p-0 border-0 bg-transparent text-right ${
        onClick ? 'cursor-pointer hover:underline underline-offset-4 decoration-accent' : ''
      }`}
    >
      <span
        className={`font-mono tabular-nums text-xl leading-none ${
          tone === 'accent' ? 'text-accent-ink' : 'text-ink'
        }`}
      >
        {value}
      </span>
      <span className="text-2xs text-muted whitespace-nowrap">{label}</span>
    </Tag>
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
  const compact = useIsCompact();
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
            publisher: 'Trips',
            // Nothing here is waiting for a picture: looking at the day's
            // media is the point, so a click should show it large.
            intent: 'browse',
            within: { from: trip.startDate, to: trip.endDate, label: trip.name },
          }
        : null,
    [selected, trip.startDate, trip.endDate, trip.name],
  );
  usePublishMediaScope(mediaScope);

  const mutate = useCallback(
    (posts: TripPost[]) => onChange({ ...trip, posts, updatedAt: Date.now() }),
    [trip, onChange],
  );

  /**
   * Start a piece from the open day and go straight to it.
   *
   * One gesture, two places: the day panel's three buttons and the verbs the
   * shell draws under a picture being looked at (`usePublishMediaActions`
   * below). Both land here so there is one answer to what a new piece is — the
   * look the trip last gave that kind, no name yet (it is named in the editor,
   * where you can see what it shows), and no picture written onto it: the
   * active Library asset reaches the slide by the path that already exists,
   * never by a second one.
   */
  const startPieceOn = useCallback(
    (kind: PostKind, date: IsoDate) => {
      const post = createTripPost(kind, date, '', null, trip.hookDefaults[kind]);
      mutate([...trip.posts, post]);
      onOpenPost(post);
    },
    [trip.hookDefaults, trip.posts, mutate, onOpenPost],
  );
  const startPiece = useCallback(
    (kind: PostKind) => {
      if (selected) startPieceOn(kind, selected);
    },
    [selected, startPieceOn],
  );

  // The same three verbs, offered wherever the shell shows one of this day's
  // pictures large — the sheet is where "this one is worth a piece" is
  // actually decided, and it used to be three screens from anything that
  // could act on it. The heading names the DAY the piece would land on: the
  // Library's local tab holds pictures from any day, and a piece is keyed by
  // the day it tells, not by the file it shows.
  const offer = useMemo<MediaActions | null>(
    () =>
      selected
        ? {
            heading: `Start a piece on ${formatIsoDate(selected)}`,
            actions: POST_KINDS.map((k) => ({
              id: k.id,
              label: k.label,
              hint: `${k.hint} — from this picture`,
              run: () => startPiece(k.id),
            })),
          }
        : null,
    [selected, startPiece],
  );
  usePublishMediaActions(offer);

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

  // Each day's leg — its tint on the cell, its name and its rank on the hover
  // card. The LAST covering stage wins, as `stageAt` resolves it, so a travel
  // day wears the leg it ended in.
  const dayStages = useMemo(() => {
    const map = new Map<IsoDate, DayStage>();
    trip.stages.forEach((stage, index) => {
      const label = stageLabel(stage);
      const tint = stageTint(index);
      for (const day of enumerateDays(stage.startDate, stage.endDate)) {
        if (!isWithin(trip.startDate, trip.endDate, day)) continue;
        const where = stageDayNumber(stage, day);
        if (!where) continue;
        map.set(day, { label, tint, day: where.day, total: where.total });
      }
    });
    return map;
  }, [trip]);

  // The legs under the heatmap, on its own week axis — the same bars the
  // ruler draws, so the two say the same thing about a stage's days.
  const legs = useMemo<HeatmapLeg[]>(
    () =>
      rulerBars(trip).map((bar) => ({
        id: bar.stage.id,
        label: stageLabel(bar.stage) || `Stage ${bar.index + 1}`,
        tint: stageTint(bar.index),
        from: bar.from,
        length: bar.length,
        lane: bar.lane,
        selected: bar.stage.id === selectedStageId,
      })),
    [trip, selectedStageId],
  );
  const openLegById = useCallback(
    (id: string) => {
      const stage = trip.stages.find((s) => s.id === id);
      if (stage) openStage(stage);
    },
    [trip.stages, openStage],
  );

  // A right-click on a day tells it first — the reason the grid exists — and
  // edits its stage second, under a rule: the two groups act on different
  // things. A piece started here lands on the day CLICKED, not on the day
  // open below, and opens straight away, like the day panel's own buttons.
  const menuFor = useCallback(
    (date: IsoDate): DayMenuItem[] => [
      ...POST_KINDS.map((k) => ({
        group: 'Tell this day',
        label: k.label,
        run: () => startPieceOn(k.id, date),
      })),
      ...dayStageActions(trip, date).map((action) => ({
        group: 'Stage',
        label: action.label,
        run: () => {
          const result = action.apply(trip);
          setStages(result.stages);
          setStageId(result.selectedId);
        },
      })),
    ],
    [trip, setStages, startPieceOn],
  );

  const drafted = coverage.posts - coverage.publishedPosts;
  const rungOf = useMemo(() => new Map(coverage.days.map((d) => [d.date, levelOf(d)])), [coverage.days]);
  const rungAt = useCallback((date: IsoDate) => rungOf.get(date) ?? 0, [rungOf]);
  const short = isShortTrip(coverage.totalDays);

  // The loupe: the window of a long trip the ruler details (`loupe.ts`). It
  // opens around the open day, follows the open day when a click leaves it,
  // and is dragged on the heatmap. Not stored: where you are looking is not
  // part of the trip.
  const [loupe, setLoupe] = useState<Loupe>(() => defaultLoupe(trip, selected));
  const { startDate: tripStart, endDate: tripEnd } = trip;
  useEffect(() => {
    setLoupe((l) => loupeContaining({ startDate: tripStart, endDate: tripEnd }, l, selected ?? tripStart));
    // Keyed on the DATES and the open day, never on the document: a leg
    // dragged in a window scrolled away from the open day changes the trip,
    // and re-running here yanked the window back to that day mid-edit.
  }, [tripStart, tripEnd, selected]);
  const panLoupe = useCallback(
    (weeks: number) => setLoupe((l) => moveLoupe({ startDate: tripStart, endDate: tripEnd }, l, weeks * 7)),
    [tripStart, tripEnd],
  );

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
      onChange({ ...next, cover: details.cover, updatedAt: Date.now() });
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
      className={pageScroll}
      aria-label={`${trip.name} overview`}
    >
      {/* The trip's NAME sits in the bar, right after the way back — the same
          shape the Studio's project name has, so a document of either tool is
          found in the same place. What does not fit that one-pill line is the
          route and the dates, which keep a line of their own below: they are
          what was clipping on a 390px screen, not the name. */}
      <PageBar
        back={{ label: 'Trips', onClick: onShowTrips }}
        trailing={
          <>
            {headerExtra}
            <Button
              onClick={() => setEditingDetails(true)}
              icon={Icons.settings}
              title="The trip's dates, route and cover"
            >
              Trip settings
            </Button>
          </>
        }
      />

      {/* The heading IS the summary: the name (click to rename), the route
          and the dates (click to edit them), and the three figures the tool
          exists for. The five-count strip and the "longest stretch" sentence
          it replaces were the top third of the screen before the calendar. */}
      <div
        className={`flex items-end gap-x-6 gap-y-2 min-w-0 pb-2 ${
          compact ? 'flex-wrap' : ''
        }`}
      >
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <TripTitle name={trip.name} onRename={rename} />
          <button
            type="button"
            onClick={() => setEditingDetails(true)}
            title="Change the trip's dates and route"
            className="self-start p-0 border-0 bg-transparent text-xs text-muted text-left cursor-pointer hover:text-accent-ink hover:underline underline-offset-[3px]"
          >
            {trip.destination && <>{trip.destination} · </>}
            <span className="font-mono tabular-nums">
              {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
            </span>
            {' · '}
            {coverage.totalDays} day{coverage.totalDays === 1 ? '' : 's'}
            {trip.stages.length > 0 && (
              <>
                {' · '}
                {trip.stages.length} stage{trip.stages.length === 1 ? '' : 's'}
              </>
            )}
          </button>
        </div>
        <div className={`flex items-end gap-6 ${compact ? 'w-full justify-between gap-3' : ''}`}>
          <Figure
            value={
              <>
                {coverage.toldDays}
                <span className="text-muted">/{coverage.totalDays}</span>
              </>
            }
            label="days told"
          />
          <Figure
            value={coverage.publishedPosts}
            label={drafted > 0 ? `published · ${drafted} drafted` : 'published'}
          />
          {coverage.longestGap && (
            <Figure
              value={coverage.longestGap.length}
              label="days of silence at most"
              tone="accent"
              title={`${formatIsoDate(coverage.longestGap.start)} → ${formatIsoDate(coverage.longestGap.end)} — go there`}
              onClick={() => selectDate(coverage.longestGap!.start)}
            />
          )}
        </div>
      </div>

      {/* A month or less is a STRIP — every day a cell of real width, the
          legs right under it on the same axis, no zoom. Longer, the weekday
          heatmap: the only thing that shows a year at a glance. */}
      <section className="flex flex-col gap-2" aria-label="The journey, day by day">
        {short ? (
          <ShortDayStrip
            days={coverage.days}
            selected={selected}
            onSelect={selectDate}
            stageOf={(date) => dayStages.get(date) ?? null}
            menuFor={menuFor}
          />
        ) : (
          <DayHeatmap
            startDate={trip.startDate}
            endDate={trip.endDate}
            days={coverage.days}
            selected={selected}
            onSelect={selectDate}
            stageOf={(date) => dayStages.get(date) ?? null}
            menuFor={menuFor}
            legs={legs}
            onOpenLeg={openLegById}
            overlay={(geometry) => (
              <LoupeBrush
                trip={trip}
                loupe={loupe}
                onChange={setLoupe}
                geometry={geometry}
                extraHeight={legs.length > 0 ? 8 + legs.reduce((n, l) => Math.max(n, l.lane + 1), 0) * 21 - 3 : 0}
              />
            )}
          />
        )}
      </section>

      <StagesPanel
        trip={trip}
        span={short ? undefined : { startDate: loupe.start, endDate: loupe.end }}
        onPanSpan={panLoupe}
        rungAt={rungAt}
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
          onStartPost={startPiece}
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
