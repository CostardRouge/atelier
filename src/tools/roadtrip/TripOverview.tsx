import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { deleteThumbs } from '../../shared/roadtrip/trip-store';
import { applyTripDetails } from '../../shared/roadtrip/trip-edit';
import { dayStageActions, nearerEdge, resizeStage } from '../../shared/roadtrip/stage-edit';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import {
  addDays,
  daysBetween,
  enumerateDays,
  formatIsoDate,
  isWithin,
  toIsoDate,
  type IsoDate,
} from '../../shared/roadtrip/trip-days';
import { stageAt, stageDayNumber, tripCoverage } from '../../shared/roadtrip/trip-coverage';
import { stageLabel, tripRouteLabel } from '../../shared/roadtrip/trip-places';
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
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { readCapture, type CaptureDate } from '../../shared/roadtrip/media-date';
import { gazetteerOrEmpty } from '../../shared/roadtrip/load-gazetteer';
import {
  locatePicture,
  type LocateProposal,
  type PictureLocation,
} from '../../shared/roadtrip/locate-picture';
import { levelOf, type DayMenuItem, type DayStage } from './DayHeatmap';
import DayPanel from './DayPanel';
import LocatePicturePanel from './LocatePicturePanel';
import StagesPanel, { StageCard } from './StagesPanel';
import TripDetailsModal, { type TripDetails } from './TripDetailsModal';
import PageBar from '../../shared/ui/PageBar';
import { useAtLeast, useIsCompact } from '../../shared/ui/use-layout-mode';
import { Icons } from '../../shared/ui/icons';
import Button from '../../shared/ui/Button';
import MonthCalendar, { type AdjustLeg, type DayPicture } from './MonthCalendar';
import Segmented from '../../shared/ui/Segmented';
import type { MonthBlock } from '../../shared/roadtrip/month-grid';
import BottomSheet from '../../shared/ui/BottomSheet';
import IconButton from '../../shared/ui/IconButton';
import DayStrip from './DayStrip';
import useDayThumbs from './use-day-thumbs';
import LegsSheet from './LegsSheet';
import { usePublishSectionBar } from '../../shared/ui/section-rail';

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
  /** Instances the itinerary can be deduced from — a date range, not a timeline. */
  deduceSources?: string[];
  onDeduceFrom?: (sourceId: string) => void;
}

type CalendarView = 'rungs' | 'pictures';
const VIEW_KEY = 'atelier.roadtrip.calendar.view';

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
function TripTitle({
  name,
  onRename,
  size = 'lg',
}: {
  name: string;
  onRename: (name: string) => void;
  /** `md` is the size that sits in the bar on a phone; `lg` the heading of a wide screen. */
  size?: 'lg' | 'md';
}) {
  const face = size === 'lg' ? 'text-2xl' : 'text-xl';
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
        className={`w-full min-w-0 max-w-[28rem] font-serif ${face} leading-tight px-1.5 py-0.5 border border-line-strong rounded-control bg-paper text-ink focus:outline-none focus:border-accent`}
      />
    );
  }

  return (
    <h1 className="m-0 min-w-0 max-w-[28rem]">
      <button
        type="button"
        onClick={() => setDraft(name)}
        title="Rename the trip"
        className={`w-full p-0 border-0 bg-transparent font-serif ${face} leading-tight text-ink text-left truncate cursor-text hover:text-accent-ink`}
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
  deduceSources,
  onDeduceFrom,
}: TripOverviewProps) {
  const compact = useIsCompact();
  const expanded = useAtLeast('expanded');
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

  /**
   * «Situer cette photo» — the second gesture of the itinerary deduction, and
   * the one a single picture can answer: where was I that day?
   *
   * The verb only ASKS. `run` is called in the same tick as the activation, so
   * the active asset is not readable from its closure (`architecture.md`, the
   * Develop tool's own note): a counter is bumped and the effect below answers
   * after the render, from the asset as it then is. What it reads is the
   * picture's own EXIF — the file's, else the instance's record of it — and
   * the name comes from the committed city index, never from a lookup going
   * out (`gazetteer.ts`).
   */
  const lib = useAssetLibrary();
  const [pendingLocate, setPendingLocate] = useState(0);
  const [locating, setLocating] = useState<{
    name: string;
    problem?: string;
    read: {
      capture: CaptureDate | null;
      coords: { lat: number; lon: number } | null;
      location: PictureLocation;
    } | null;
  } | null>(null);

  // Which read is the current one. NOT a teardown flag: this effect is keyed
  // on the counter and resets it, so its own cleanup fires one render later —
  // a `cancelled` flag set there cancels the very read it just started, and
  // the sheet stays on "reading the picture…" for ever. Measured.
  const locateSeq = useRef(0);
  useEffect(() => {
    if (pendingLocate === 0) return;
    setPendingLocate(0);
    const seq = ++locateSeq.current;
    const asset = lib.assets.find((a) => a.id === lib.activeId) ?? null;
    const file = asset?.parts.image ?? null;
    if (!file) {
      setLocating({
        name: asset?.baseName ?? 'this media',
        problem:
          'Only a photograph carries a position of its own — a clip’s flight log is not read here.',
        read: null,
      });
      return;
    }
    setLocating({ name: file.name, read: null });
    void (async () => {
      // One read of the file's head answers both questions, and the index is
      // fetched only now — never at boot (`load-gazetteer.ts`).
      const [capture, cities] = await Promise.all([readCapture(file), gazetteerOrEmpty()]);
      if (locateSeq.current !== seq) return;
      setLocating({
        name: file.name,
        read: {
          capture: capture.date,
          coords: capture.coords,
          location: locatePicture({
            trip,
            date: capture.date?.date ?? null,
            coords: capture.coords,
            cities,
          }),
        },
      });
    })();
  }, [pendingLocate, lib.assets, lib.activeId, trip]);

  // The verbs offered wherever the shell shows one of this day's pictures
  // large — the sheet is where "this one is worth a piece" is actually
  // decided, and it used to be three screens from anything that could act on
  // it. The heading names the DAY a PIECE would land on: the Library's local
  // tab holds pictures from any day, and a piece is keyed by the day it tells,
  // not by the file it shows. Locating is about the picture's OWN day instead,
  // and the seam carries ONE heading for the whole row — so the heading says
  // both jobs rather than letting the piece sentence claim the fourth verb,
  // and the sheet it opens states the day it measured before writing anything.
  const offer = useMemo<MediaActions | null>(
    () =>
      selected
        ? {
            heading: `Start a piece on ${formatIsoDate(selected)} · or locate it`,
            actions: [
              ...POST_KINDS.map((k) => ({
                id: k.id,
                label: k.label,
                hint: `${k.hint} — from this picture`,
                run: () => startPiece(k.id),
              })),
              {
                id: 'locate',
                label: 'Locate it',
                hint: 'Name where this picture was taken, and offer that place to the leg of its own day',
                run: () => setPendingLocate((n) => n + 1),
              },
            ],
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
  /**
   * Accept what the picture said. It writes through the stage editors that
   * already exist (`locate-picture.ts` composes them), so there is no second
   * way into the document — and the calendar follows to the day that was
   * measured, with the leg it touched open underneath, because a change you
   * cannot see is a change nobody can check.
   */
  const acceptLocation = useCallback(
    (proposal: LocateProposal) => {
      const date = locating?.read?.location.date ?? null;
      const result = proposal.apply(trip);
      setStages(result.stages);
      if (date) onSelectDate(date);
      setStageId(result.selectedId);
      setLocating(null);
    },
    [locating, trip, setStages, onSelectDate],
  );

  // The dates-and-route sheet, the creation modal reopened on this trip.
  const [editingDetails, setEditingDetails] = useState(false);
  // The phone's day sheet: pulled up from the strip, never by a tap on a cell.
  const [dayOpen, setDayOpen] = useState(false);
  // Read once here so the strip and the sheet draw the same pictures.
  const dayThumbs = useDayThumbs(selectedCell?.posts ?? []);
  // The phone's legs sheet — the ruler's job, as a list.
  const [legsOpen, setLegsOpen] = useState(false);

  // Rungs or pictures: ONE toggle, in the bar, remembered by the browser —
  // the gallery's Cards / Bands rule, since it is the same kind of decision.
  // A view is the trip's, never a month's, so it is never drawn per block.
  const [view, setView] = useState<CalendarView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'pictures' ? 'pictures' : 'rungs';
    } catch {
      return 'rungs';
    }
  });
  const chooseView = (next: CalendarView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode */
    }
  };
  // The pictures view reads the hooks of the month on screen and its two
  // neighbours, never the whole trip's: a year of pieces is a year of JPEGs
  // in memory for cells that are not on screen.
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const onVisible = useCallback((block: MonthBlock) => setVisibleKey(block.key), []);
  const windowPosts = useMemo(() => {
    if (view !== 'pictures' || !visibleKey) return [];
    const [y, m] = visibleKey.split('-').map(Number);
    const ordinal = y * 12 + (m - 1);
    return trip.posts.filter((p) => {
      const o = Number(p.date.slice(0, 4)) * 12 + (Number(p.date.slice(5, 7)) - 1);
      return Math.abs(o - ordinal) <= 1;
    });
  }, [view, visibleKey, trip.posts]);
  const windowThumbs = useDayThumbs(windowPosts);
  // The days the ruler details on a wide screen: the month on screen and its
  // two neighbours, clamped to the trip — the loupe, read from the scroll.
  const spanOnScreen = useMemo(() => {
    if (!visibleKey) return undefined;
    const [y, m] = visibleKey.split('-').map(Number);
    const start = toIsoDate(Date.UTC(y, m - 2, 1));
    const end = toIsoDate(Date.UTC(y, m + 1, 0));
    return {
      startDate: start < trip.startDate ? trip.startDate : start,
      endDate: end > trip.endDate ? trip.endDate : end,
    };
  }, [visibleKey, trip.startDate, trip.endDate]);
  const pictures = useMemo(() => {
    if (view !== 'pictures') return undefined;
    const out = new Map<IsoDate, DayPicture>();
    for (const day of coverage.days) {
      if (!day.posts.length) continue;
      // A published piece first, then the first with a hook at all.
      const pick =
        day.posts.find((p) => p.publishedAt !== null && windowThumbs.has(p.id)) ??
        day.posts.find((p) => windowThumbs.has(p.id));
      const url = pick ? windowThumbs.get(pick.id) : undefined;
      if (!url) continue;
      out.set(day.date, { url, count: day.posts.length, published: day.published > 0 });
    }
    return out;
  }, [view, coverage.days, windowThumbs]);

  // A leg being adjusted ON the calendar: a draft of its dates, written to
  // the trip on Done and dropped on Cancel — the garage's rule for a modal
  // edit. While it lasts the calendar draws only this leg, a tap on a day
  // moves the nearer edge there, and the two grips move an edge a cell at a
  // time (`docs/roadtrip-overview-mobile.md` §8.3).
  const [adjusting, setAdjusting] = useState<{ id: string; draft: TripStage } | null>(null);
  const startAdjust = useCallback(
    (id: string) => {
      const stage = trip.stages.find((s) => s.id === id);
      if (!stage) return;
      setLegsOpen(false);
      setDayOpen(false);
      setStageId(id);
      setAdjusting({ id, draft: stage });
    },
    [trip.stages],
  );
  const moveEdge = useCallback(
    (edge: 'start' | 'end', date: IsoDate) =>
      setAdjusting((a) => (a ? { ...a, draft: resizeStage(trip, a.draft, edge, date) } : a)),
    [trip],
  );
  const finishAdjust = useCallback(
    (keep: boolean) => {
      // Read from the closure, never inside the updater: writing the trip
      // from there is a setState on the tool while this component renders.
      if (adjusting && keep) setStages(trip.stages.map((s) => (s.id === adjusting.id ? adjusting.draft : s)));
      setAdjusting(null);
    },
    [adjusting, trip.stages, setStages],
  );
  useEffect(() => {
    if (!adjusting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finishAdjust(false);
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) finishAdjust(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adjusting, finishAdjust]);
  const adjust = useMemo<AdjustLeg | undefined>(
    () => (adjusting ? { stage: adjusting.draft, onEdge: moveEdge } : undefined),
    [adjusting, moveEdge],
  );
  // The calendar draws the DRAFT where the trip holds the stage.
  const shownTrip = useMemo(
    () => (adjusting ? { ...trip, stages: trip.stages.map((s) => (s.id === adjusting.id ? adjusting.draft : s)) } : trip),
    [trip, adjusting],
  );

  // The overview's own cells on the shell's bottom bar, which the shell draws
  // on every compact tool screen anyway (`SectionRail`): the legs and the trip
  // are sheets, so the two verbs the wide screen keeps in its header and its
  // stages panel cost a phone no height at all. Marked only while their
  // sheet is UP, the rule the piece editor's bar follows.
  usePublishSectionBar(
    useMemo(
      () =>
        compact
          ? {
              sections: [
                { id: 'legs', label: 'Stages' },
                { id: 'trip', label: 'Trip' },
              ],
              active: adjusting ? null : legsOpen ? 'legs' : editingDetails ? 'trip' : null,
              label: 'Trip overview',
              onSelect: (id: string) => {
                if (id === 'legs') setLegsOpen(true);
                else setEditingDetails(true);
              },
            }
          : null,
      [compact, legsOpen, editingDetails, adjusting],
    ),
  );
  const saveDetails = useCallback(
    (details: TripDetails) => {
      setEditingDetails(false);
      const next = applyTripDetails(trip, {
        startDate: details.startDate,
        endDate: details.endDate,
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

  const stagesPanel = (
    <StagesPanel
      trip={trip}
      span={spanOnScreen}
      hideCard={expanded}
      rungAt={rungAt}
      selectedId={selectedStageId}
      cursorDate={selected}
      onSelect={setStageId}
      onOpenStage={openStage}
      onScrub={selectDate}
      onChange={setStages}
      timelineSources={timelineSources}
      onCompleteFrom={onCompleteFrom}
      deduceSources={deduceSources}
      onDeduceFrom={onDeduceFrom}
    />
  );

  const dayPanel = selected && (
    <DayPanel
      trip={trip}
      date={selected}
      cell={selectedCell}
      thumbs={dayThumbs}
      variant={compact ? 'sheet' : 'card'}
      onEditLeg={
        compact
          ? (id) => {
              setDayOpen(false);
              setStageId(id);
              setLegsOpen(true);
            }
          : undefined
      }
      onStartPost={startPiece}
      onAddPost={(post) => mutate([...trip.posts, post])}
      onUpdatePost={(post) => mutate(trip.posts.map((p) => (p.id === post.id ? post : p)))}
      onDeletePost={(id) => {
        void deleteThumbs([id]);
        mutate(trip.posts.filter((p) => p.id !== id));
      }}
      onOpenPost={onOpenPost}
    />
  );

  const sheets = (
    <>
      {locating && (
        <LocatePicturePanel
          trip={trip}
          name={locating.name}
          read={locating.read}
          problem={locating.problem}
          onCancel={() => setLocating(null)}
          onAccept={acceptLocation}
        />
      )}

      {editingDetails && (
        <TripDetailsModal
          trip={trip}
          onCancel={() => setEditingDetails(false)}
          onSubmit={saveDetails}
        />
      )}
    </>
  );

  if (compact) {
    // A phone: the calendar is the ONE day surface and takes the column
    // (`docs/roadtrip-overview-mobile.md` §8). The heading that costs ~110px
    // on a wide screen — a serif title, a subtitle, three figures — is one
    // pill-high bar and one mono line here, because the 624px the shell
    // leaves are spent on the month, not on the summary.
    return (
      <section className="flex flex-col flex-1 min-h-0 overflow-hidden" aria-label={`${trip.name} overview`}>
        <PageBar
          back={{ label: 'Trips', onClick: onShowTrips, iconOnly: true }}
          trailing={
            <>
              {headerExtra}
              <span
                className="inline-flex items-baseline gap-0.5 px-2 py-1 rounded-control bg-paper-2 font-mono text-xs tabular-nums text-ink-soft whitespace-nowrap"
                title="Days told, of the trip's days"
              >
                {coverage.toldDays}
                <span className="text-muted">/{coverage.totalDays}</span>
              </span>
              <Segmented
                size="sm"
                label="How the days are drawn"
                value={view}
                onChange={chooseView}
                options={[
                  { id: 'rungs', label: <span className="sr-only">Rungs</span>, icon: Icons.grid, title: 'Each day as its rung: nothing, drafted, published once, twice, more' },
                  { id: 'pictures', label: <span className="sr-only">Pictures</span>, icon: Icons.image, title: 'Each told day as the hook of its piece' },
                ]}
              />
            </>
          }
        >
          <span className="min-w-0 flex-1">
            <TripTitle name={trip.name} onRename={rename} size="md" />
          </span>
        </PageBar>

        {adjusting ? (
          /* The band of the mode, in place of the figures: which leg, its
             draft span, and the two ways out. Nothing else is on screen
             about anything else. */
          <div className="flex items-center gap-2 mt-1.5 mb-1 px-2.5 py-1.5 rounded-control border border-accent/40 bg-accent-wash">
            <span
              className="flex-none w-2.5 h-2.5 rounded-full"
              style={{ background: stageTint(trip.stages.findIndex((s) => s.id === adjusting.id)) }}
              aria-hidden="true"
            />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold leading-tight truncate">
                {stageLabel(adjusting.draft) || 'Unnamed stage'}
              </span>
              <span className="block font-mono text-2xs text-accent-ink truncate">
                {formatIsoDate(adjusting.draft.startDate)} → {formatIsoDate(adjusting.draft.endDate)} ·{' '}
                {(daysBetween(adjusting.draft.startDate, adjusting.draft.endDate) ?? 0) + 1} d
              </span>
            </span>
            <Button size="sm" onClick={() => finishAdjust(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => finishAdjust(true)}>
              Done
            </Button>
          </div>
        ) : (
        <p className="m-0 mt-1.5 mb-1 font-mono text-2xs text-muted truncate">
          {coverage.publishedPosts} published
          {drafted > 0 && ` · ${drafted} drafted`}
          {coverage.longestGap && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => selectDate(coverage.longestGap!.start)}
                title={`${formatIsoDate(coverage.longestGap.start)} → ${formatIsoDate(coverage.longestGap.end)} — go there`}
                className="p-0 border-0 bg-transparent font-mono text-2xs text-accent-ink underline underline-offset-2 decoration-accent/60 cursor-pointer"
              >
                {coverage.longestGap.length} days of silence at most
              </button>
            </>
          )}
        </p>
        )}

        <MonthCalendar
          trip={shownTrip}
          days={coverage.days}
          selected={selected}
          onSelect={adjusting ? (date) => moveEdge(nearerEdge(adjusting.draft, date), date) : selectDate}
          adjust={adjust}
          pictures={pictures}
          onVisible={onVisible}
          stageOf={(date) => dayStages.get(date) ?? null}
          menuFor={menuFor}
          onOpenLeg={(id) => {
            setStageId(id);
            setLegsOpen(true);
          }}
          selectedLegId={selectedStageId}
        />

        {adjusting ? (
          /* The keyboard twin of the grips, visible: nothing in this suite
             is drag-only. One day per press, a week with Shift. */
          <div className="flex-none flex gap-2 px-3 py-2 border-t border-line-strong bg-surface">
            {(['start', 'end'] as const).map((edge) => {
              const value = edge === 'start' ? adjusting.draft.startDate : adjusting.draft.endDate;
              const step = (days: number) => {
                const next = addDays(value, days);
                if (next) moveEdge(edge, next);
              };
              return (
                <div key={edge} className="flex-1 min-w-0 flex items-center gap-1">
                  <span className="flex-none font-mono text-3xs tracking-[0.08em] uppercase text-muted">
                    {edge === 'start' ? 'Arrived' : 'Left'}
                  </span>
                  <IconButton size="sm" label={`${edge === 'start' ? 'Arrival' : 'Departure'} a day earlier`} onClick={(e) => step(e.shiftKey ? -7 : -1)}>
                    {Icons.back}
                  </IconButton>
                  <span className="flex-1 text-center font-mono text-2xs tabular-nums truncate">{formatIsoDate(value)}</span>
                  <IconButton size="sm" label={`${edge === 'start' ? 'Arrival' : 'Departure'} a day later`} onClick={(e) => step(e.shiftKey ? 7 : 1)}>
                    {Icons.forward}
                  </IconButton>
                </div>
              );
            })}
          </div>
        ) : selected && (
          <DayStrip
            date={selected}
            cell={selectedCell}
            stage={dayStages.get(selected) ?? null}
            thumbs={dayThumbs}
            onOpen={() => setDayOpen(true)}
          />
        )}

        {dayOpen && selected && (
          <BottomSheet
            open
            onClose={() => setDayOpen(false)}
            title={`Day ${selectedCell?.dayNumber ?? '—'} / ${coverage.totalDays}`}
            hint={formatIsoDate(selected)}
            snaps={[0.62, 0.92]}
          >
            <div className="px-4 pt-2 pb-4">{dayPanel}</div>
          </BottomSheet>
        )}

        {legsOpen && (
          <BottomSheet
            open
            onClose={() => setLegsOpen(false)}
            title="Stages"
            hint={`${trip.stages.length} leg${trip.stages.length === 1 ? '' : 's'}`}
            snaps={[0.72, 0.92]}
          >
            <LegsSheet
              trip={trip}
              rungAt={rungAt}
              selectedId={selectedStageId}
              onSelect={setStageId}
              onChange={setStages}
              onAdjust={startAdjust}
              timelineSources={timelineSources}
              onCompleteFrom={onCompleteFrom}
              deduceSources={deduceSources}
              onDeduceFrom={onDeduceFrom}
            />
          </BottomSheet>
        )}

        {sheets}
      </section>
    );
  }

  // The open leg's card, where a wide screen puts it: beside the calendar
  // above 1180px, under the ruler below that (StagesPanel draws it there).
  const openLeg = selectedStageId ? trip.stages.find((st) => st.id === selectedStageId) ?? null : null;
  const stageCard = openLeg && (
    <StageCard
      key={openLeg.id}
      trip={trip}
      stage={openLeg}
      index={trip.stages.indexOf(openLeg)}
      onChange={(next) => setStages(trip.stages.map((st) => (st.id === next.id ? next : st)))}
      onDelete={() => {
        setStages(trip.stages.filter((st) => st.id !== openLeg.id));
        setStageId(null);
      }}
      onClose={() => setStageId(null)}
    />
  );

  return (
    <section
      className="flex flex-col flex-1 min-h-0 overflow-hidden -mx-1 px-1"
      aria-label={`${trip.name} overview`}
    >
      {/* The trip's NAME sits in the bar, right after the way back — the same
          shape the Studio's project name has, so a document of either tool is
          found in the same place. What does not fit that one-pill line is the
          route and the dates, which keep a line of their own below. */}
      <PageBar
        back={{ label: 'Trips', onClick: onShowTrips }}
        trailing={
          <>
            {headerExtra}
            <Segmented
              size="sm"
              label="How the days are drawn"
              value={view}
              onChange={chooseView}
              options={[
                { id: 'rungs', label: 'Rungs', icon: Icons.grid, title: 'Each day as its rung: nothing, drafted, published once, twice, more' },
                { id: 'pictures', label: 'Pictures', icon: Icons.image, title: 'Each told day as the hook of its piece' },
              ]}
            />
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
          exists for. */}
      <div className="flex-none flex items-end gap-x-6 gap-y-2 min-w-0 pb-2">
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <TripTitle name={trip.name} onRename={rename} />
          <button
            type="button"
            onClick={() => setEditingDetails(true)}
            title="Change the trip's dates"
            className="self-start p-0 border-0 bg-transparent text-xs text-muted text-left cursor-pointer hover:text-accent-ink hover:underline underline-offset-[3px]"
          >
            {/* Derived from the legs, never stored: the line follows them. */}
            {tripRouteLabel(trip) && <>{tripRouteLabel(trip)} · </>}
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
        <div className="flex items-end gap-6">
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

      {/* The same blocks as the phone, three to a row above 1180px and two
          below, the year map above them and the ruler between — which now
          details the months the calendar shows, the loupe read from the
          scroll rather than dragged. The day and the open leg are a column
          beside the calendar where there is room for one, under it where
          there is not. */}
      <div className="flex-1 min-h-0 flex gap-5">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <MonthCalendar
            trip={trip}
            days={coverage.days}
            selected={selected}
            onSelect={selectDate}
            stageOf={(date) => dayStages.get(date) ?? null}
            menuFor={menuFor}
            onOpenLeg={openLegById}
            selectedLegId={selectedStageId}
            pictures={pictures}
            onVisible={onVisible}
            columns={expanded ? 3 : 2}
            between={<div className="flex-none pb-3">{stagesPanel}</div>}
            tail={!expanded ? <div className="pt-4">{dayPanel}</div> : undefined}
          />
        </div>
        {expanded && (
          <aside className="flex-none w-[22rem] min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-4 pb-4" aria-label="The open day and the open leg">
            {dayPanel}
            {stageCard && (
              <div className="bg-surface border border-line rounded-paper-lg px-5 pb-5 pt-3">{stageCard}</div>
            )}
          </aside>
        )}
      </div>

      {sheets}
    </section>
  );
}
