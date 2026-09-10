import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import { tripCoverage, type TripCoverage } from '../../shared/roadtrip/trip-coverage';
import {
  coverTiles,
  rhythmBuckets,
  rhythmLevel,
  type CoverTile,
} from '../../shared/roadtrip/trip-cover';
import { createTripDoc, type TripCover, type TripDoc } from '../../shared/roadtrip/trip-types';
import {
  TRIP_FILE_ACCEPT,
  TRIP_FILE_EXTENSION,
  parseTripFile,
  serializeTripFile,
  toTripFile,
  tripDocFromFile,
  tripFileName,
} from '../../shared/roadtrip/trip-file';
import { pickFile } from '../../shared/sources/file-sources';
import {
  DEFAULT_SOURCE_ID,
  groupBySource,
  listSources,
  sourceById,
  type SourceInfo,
} from '../../shared/sources/source';
import {
  listWinnowConnections,
  subscribeWinnowConnections,
} from '../../shared/sources/winnow/store';
import { downloadBlob } from '../../shared/media/save';
import {
  deleteSyncRecord,
  deleteThumbs,
  deleteTrip,
  getSyncRecord,
  listTrips,
  putTrip,
} from '../../shared/roadtrip/trip-store';
import {
  deleteRemoteTrip,
  explainFailure,
  failureOf,
  isRemoteSource,
  listRemoteTrips,
  mirrorTrip,
  moveTrip,
  pushTrip,
  remoteFor,
  type RemoteTripRow,
} from '../../shared/roadtrip/trip-remote';
import TripDetailsModal, { type TripDetails, type TimelineSourceOption } from './TripDetailsModal';
import ImportTripModal from './ImportTripModal';
import TripCoverModal from './TripCoverModal';
import { HEATMAP_LEVELS } from './heatmap-ramp';
import useCoverThumbs from './use-cover-thumbs';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';

interface TripGalleryProps {
  openTripId: string | null;
  onOpen: (trip: TripDoc) => void;
  /** Connected Winnows the New trip modal may offer as a seed. */
  timelineSources?: TimelineSourceOption[];
  onSeedFrom?: (sourceId: string) => void;
  /**
   * How an edit to the OPEN trip is saved. The tool keeps that document in its
   * own save machine while the gallery is showing, so a cover written straight
   * to the store here would be overwritten by its next flush.
   */
  onChangeOpenTrip?: (doc: TripDoc) => void;
}

/**
 * The sources that can HOLD a trip: this browser, plus every connected
 * instance whose capabilities say it has a document bucket. The connection
 * list is the argument only so a memo re-runs when a connection comes or
 * goes — `listSources()` is the store's mirror and reads nothing itself.
 */
function documentSourcesFor(connections: readonly unknown[]): SourceInfo[] {
  void connections;
  return listSources().filter((s) => s.capabilities.documents);
}

/** What this device knows about one instance's list of trips. */
type RemoteList =
  | { status: 'loading' }
  | { status: 'ok'; rows: RemoteTripRow[] }
  | { status: 'failed'; text: string; login?: string };

function sourceLabel(id: string): string {
  return id === DEFAULT_SOURCE_ID ? 'this browser' : (sourceById(id)?.label ?? id);
}

/** One row of the card's overflow menu. */
const menuItem =
  'text-left font-sans text-[0.78rem] text-ink-soft bg-transparent border-0 px-2.5 py-2 rounded-[10px] cursor-pointer hover:bg-paper-2 hover:text-ink';

/** The bottom-left caption on a picture cover: which day it is looking at. */
function tileCaption(tile: CoverTile): string {
  return tile.dayNumber === null ? formatIsoDate(tile.date) : `day ${tile.dayNumber}`;
}

/**
 * The trip's own weeks, for a card with no picture to show — a new trip, a
 * fresh import, an instance whose thumbnails are not mirrored here. Derived
 * from the coverage the overview already builds, on the same five-rung ramp as
 * the grid: a trip's card and its grid must not disagree about a day.
 */
/**
 * How tall the card's cover zone is, in every one of the shapes that can fill
 * it — a picture, a rhythm band, or a "kept elsewhere" note. Two cards share a
 * phone's width, so 168px there is a third of the card before a word of it is
 * read; the bars inside shrink with it.
 */
function coverHeight(compact: boolean) {
  return compact
    ? { box: 'h-[112px]', bars: 'h-[56px]' }
    : { box: 'h-[168px]', bars: 'h-[92px]' };
}

function RhythmBand({ coverage, compact }: { coverage: TripCoverage; compact: boolean }) {
  const bars = rhythmBuckets(coverage);
  const gap = coverage.longestGap;
  const h = coverHeight(compact);
  return (
    // On the card's own surface, never on `paper-2`: the ramp's bottom rung IS
    // `paper-2`, so a trip with nothing told drew an empty box. The strip keeps
    // the grid's relationship — bare cells against the page behind them.
    <div
      className={`${h.box} bg-surface border-b border-line flex flex-col justify-between ${
        compact ? 'px-2.5 py-2' : 'px-3.5 py-3'
      }`}
    >
      <p className="m-0 font-mono text-[0.62rem] tracking-[0.08em] uppercase text-muted truncate">
        {coverage.toldDays === 0 ? (
          `${coverage.totalDays} days, none told yet`
        ) : gap && gap.length > 1 ? (
          <>
            <span className="text-accent-ink">{gap.length} days never told</span>
            <span className="text-faint"> · </span>
            {formatIsoDate(gap.start)}
          </>
        ) : (
          `${coverage.toldDays} of ${coverage.totalDays} days told`
        )}
      </p>
      <div className={`flex items-end gap-[2px] ${h.bars}`} aria-hidden="true">
        {bars.map((bar) => {
          const level = rhythmLevel(bar);
          return (
            <i
              key={bar.from}
              className="flex-1 min-w-[3px] rounded-[2px]"
              // A told day RISES from a ruler that is always drawn: a 4px stub
              // read as an empty box on a trip with nothing told yet, which is
              // every trip on its first day.
              style={{ height: `${12 + (level / 4) * 76}px`, background: HEATMAP_LEVELS[level] }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the card shows of the trip. The layout is what it ASKS for, never a
 * promise: a mosaic of one is a cover, and a mosaic of none is the rhythm —
 * `coverTiles` has already resolved which pictures exist, so nothing here can
 * fail to draw.
 */
function CoverArt({
  trip,
  coverage,
  tiles,
  urls,
  remoteOnly,
}: {
  trip: TripDoc;
  coverage: TripCoverage;
  tiles: readonly CoverTile[];
  urls: ReadonlyMap<string, string>;
  remoteOnly: boolean;
}) {
  // Read before any branch: a hook after a conditional return changes the hook
  // ORDER the moment a trip gains its first cover picture.
  const compact = useIsCompact();
  const h = coverHeight(compact);

  if (trip.cover.layout === 'none') return null;

  if (tiles.length === 0) {
    // A trip kept there and not here holds no thumbnail at all. Saying where
    // the pictures are beats drawing a shape this device does not own.
    if (remoteOnly) {
      return (
        <div className={`${h.box} bg-paper-2 flex items-center justify-center px-4`}>
          <p className="m-0 font-mono text-[0.62rem] tracking-[0.08em] uppercase text-faint text-center leading-[1.7]">
            pictures live on
            <br />
            {sourceLabel(trip.sourceId)}
          </p>
        </div>
      );
    }
    return <RhythmBand coverage={coverage} compact={compact} />;
  }

  const pic = (tile: CoverTile, className: string) => (
    <img
      key={tile.postId}
      src={urls.get(tile.postId)}
      alt=""
      loading="lazy"
      // `min-h-0`: a grid item's `min-height` is `auto`, so an image taller
      // than its cell refuses to shrink and bleeds over the card's own text —
      // clipped by the card on a wide screen, plainly visible on a narrow one.
      className={`block w-full h-full min-h-0 min-w-0 object-cover ${className}`}
    />
  );

  return (
    <div className={`relative overflow-hidden bg-paper-2 ${h.box}`}>
      {tiles.length === 1 ? (
        pic(tiles[0], '')
      ) : (
        <div
          className={`h-full grid gap-[2px] ${
            tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-[1.7fr_1fr] grid-rows-2'
          }`}
        >
          {tiles.map((tile, i) => pic(tile, i === 0 && tiles.length > 2 ? 'row-span-2' : ''))}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-[rgba(16,15,13,0.52)] pointer-events-none" />
      <span className="absolute left-3 bottom-2.5 font-mono text-[0.62rem] tracking-[0.1em] uppercase text-paper [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
        {tileCaption(tiles[0])}
      </span>
    </div>
  );
}

function TripCard({
  trip,
  isOpen,
  remoteOnly,
  moveTargets,
  busy,
  urls,
  hasThumb,
  onOpen,
  onExport,
  onDelete,
  onMove,
  onChooseCover,
}: {
  trip: TripDoc;
  isOpen: boolean;
  /** Kept on an instance and not yet mirrored here: opening pulls it first. */
  remoteOnly: boolean;
  /** The other sources this trip could be moved to. */
  moveTargets: readonly SourceInfo[];
  /** A sentence while a move or a delete is under way, or null. */
  busy: string | null;
  /** The hook pictures this device holds, by post id. */
  urls: ReadonlyMap<string, string>;
  hasThumb: (postId: string) => boolean;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove: (targetSourceId: string) => void;
  onChooseCover: () => void;
}) {
  const [confirming, setConfirming] = useState<'delete' | 'move' | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [moveTo, setMoveTo] = useState(moveTargets[0]?.id ?? '');
  const compact = useIsCompact();
  const coverage = tripCoverage(trip);
  const total = coverage.totalDays;
  const pct = total > 0 ? Math.round((coverage.toldDays / total) * 100) : 0;
  const tiles = coverTiles(trip, coverage, hasThumb);

  // A menu that only closes on its own items is a menu you cannot dismiss —
  // but it must not close on a press INSIDE itself: `pointerdown` lands before
  // `click`, so unmounting there swallows the item you were pressing (every
  // row silently did nothing but shut the menu).
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  return (
    <div
      // The whole card opens the trip — a card that shows a trip's name, its
      // dates and how much of it is told is the thing you point at, and the
      // "Open" button below stays as the keyboard and screen-reader path (and
      // as the one that says "Resume" or "Open here"). Anything already
      // interactive keeps its own click, through one guard rather than
      // `stopPropagation` sprinkled over every control: the confirm rows, the
      // move select, and the overflow menu's own padding.
      onClick={(e) => {
        if (busy !== null) return;
        if ((e.target as HTMLElement).closest('button, select, input, label, a, [role="menu"]')) {
          return;
        }
        onOpen();
      }}
      className={`group flex flex-col bg-surface border rounded-paper-lg shadow-paper-soft overflow-hidden transition-[box-shadow,border-color] duration-300 ease-paper hover:shadow-paper ${
        busy === null ? 'cursor-pointer' : ''
      } ${isOpen ? 'border-accent' : 'border-line hover:border-line-strong'} ${
        remoteOnly ? 'opacity-75' : ''
      }`}
    >
      <div className="relative">
        <CoverArt
          trip={trip}
          coverage={coverage}
          tiles={tiles}
          urls={urls}
          remoteOnly={remoteOnly}
        />
        {(isOpen || remoteOnly) && trip.cover.layout !== 'none' && (
          <span
            className={`absolute top-2.5 right-2.5 px-2 py-[3px] rounded-full border font-mono text-[0.58rem] tracking-[0.08em] uppercase bg-[rgba(251,248,241,0.92)] ${
              isOpen ? 'border-accent text-accent-ink' : 'border-line text-muted'
            }`}
          >
            {isOpen ? 'open' : 'not here yet'}
          </span>
        )}
        {/* The cover offers its own verb. It lived only in the overflow menu,
            where nothing said a cover was a choice at all — a picker you have
            to already know about is a picker nobody finds. The menu keeps the
            item as the keyboard and touch path. */}
        {trip.cover.layout !== 'none' && busy === null && (
          <button
            type="button"
            onClick={onChooseCover}
            className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-[rgba(251,248,241,0.92)] text-ink-soft font-mono text-[0.58rem] tracking-[0.08em] uppercase cursor-pointer opacity-0 transition-opacity duration-200 ease-paper group-hover:opacity-100 focus-visible:opacity-100 hover:border-accent hover:text-accent-ink"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3.5"
                y="5.5"
                width="17"
                height="13"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M4.5 16.5 9 12.5l3.5 3 3-2.5 4 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            Cover
          </button>
        )}
      </div>

      <div className={`flex flex-col ${compact ? 'gap-2 p-3.5' : 'gap-3 p-5'}`}>
        <div className="min-w-0">
          <h3
            className={`m-0 font-serif truncate ${compact ? 'text-[1.05rem]' : 'text-[1.2rem]'}`}
            title={trip.name}
          >
            {trip.name}
          </h3>
          <p className="m-0 font-mono text-[0.68rem] text-muted truncate">
            {trip.destination || 'No destination set'}
          </p>
        </div>

        {/* The day count moved down to the coverage line: with it here the date
            line wrapped onto two rows on a narrow card, for a number that
            belongs beside the days told anyway. */}
        {/* A truncated date range says nothing — the whole point of the line
            is the span — so on a phone it steps down a size rather than
            losing its second half. */}
        <p
          className={`m-0 font-mono tabular-nums text-muted truncate ${
            compact ? 'text-[0.6rem]' : 'text-[0.7rem]'
          }`}
        >
          {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
        </p>

        {/* Progress reads as "how much of the trip has been told", which is the
            number the maintainer actually tracks — not how many files exist. */}
        <div>
          <div className="h-[6px] rounded-full bg-paper-2 overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-500 ease-paper"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="m-0 mt-1.5 font-mono text-[0.66rem] text-muted tabular-nums">
            {coverage.toldDays} of {total} day{total === 1 ? '' : 's'} told
            <span className="text-faint"> · </span>
            {coverage.publishedPosts} published
          </p>
        </div>

        {busy && (
          <p className="m-0 font-mono text-[0.66rem] text-muted" role="status">
            {busy}
          </p>
        )}

        <div className="relative flex items-center gap-3 pt-1 flex-wrap">
          <button
            type="button"
            onClick={onOpen}
            disabled={busy !== null}
            className="px-3.5 py-[0.45rem] inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.78rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent disabled:opacity-50"
          >
            {isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open'}
          </button>
          <span className="flex-1" />

          {/* With no cover there is no cover zone to hang the chip on, and a
              layout that draws nothing must never be a one-way door. The verb
              moves into the row instead — the trip's details sheet holds the
              same panel, so this is the second way back, not the only one. */}
          {trip.cover.layout === 'none' && confirming === null && busy === null && (
            <button
              type="button"
              onClick={onChooseCover}
              className="p-0 border-0 bg-transparent font-mono text-[0.58rem] tracking-[0.08em] uppercase text-faint cursor-pointer opacity-0 transition-opacity duration-200 ease-paper group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent-ink"
            >
              Cover
            </button>
          )}

          {confirming === null && busy === null && (
            <button
              type="button"
              aria-label={`More actions for ${trip.name}`}
              aria-expanded={menu}
              aria-haspopup="menu"
              onClick={(e) => {
                // The window listener that closes it would swallow this click.
                e.stopPropagation();
                setMenu((open) => !open);
              }}
              className={`w-[30px] h-[30px] inline-flex items-center justify-center rounded-full border bg-transparent cursor-pointer transition-colors ${
                menu
                  ? 'border-line-strong bg-paper-2 text-ink'
                  : 'border-transparent text-faint hover:border-line hover:bg-paper hover:text-ink-soft'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="4" cy="10" r="1.5" fill="currentColor" />
                <circle cx="10" cy="10" r="1.5" fill="currentColor" />
                <circle cx="16" cy="10" r="1.5" fill="currentColor" />
              </svg>
            </button>
          )}

          {menu && (
            <div
              ref={menuRef}
              role="menu"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMenu(false);
              }}
              className="absolute right-0 bottom-full mb-2 z-10 w-[13rem] flex flex-col p-1.5 bg-surface border border-line-strong rounded-paper shadow-paper"
            >
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  setMenu(false);
                  onChooseCover();
                }}
              >
                Choose a cover…
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  setMenu(false);
                  onExport();
                }}
                title={`Save the whole trip as a ${TRIP_FILE_EXTENSION} file`}
              >
                Export the trip file
              </button>
              {moveTargets.length > 0 && !remoteOnly && (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  onClick={() => {
                    setMenu(false);
                    setConfirming('move');
                  }}
                >
                  Keep on another source…
                </button>
              )}
              <span className="h-px bg-line mx-2 my-1.5" />
              <button
                type="button"
                role="menuitem"
                className={`${menuItem} text-[#9a3a23] hover:bg-accent-wash`}
                onClick={() => {
                  setMenu(false);
                  setConfirming('delete');
                }}
              >
                Delete this trip
              </button>
            </div>
          )}

          {confirming === 'delete' && (
            <span className="flex items-center gap-2 text-[0.75rem]">
              <span className="text-muted">Delete for good?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                  onDelete();
                }}
                className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="p-0 border-0 bg-transparent text-muted cursor-pointer"
              >
                Keep
              </button>
            </span>
          )}
          {confirming === 'move' && (
            <span className="flex items-center gap-2 text-[0.75rem] flex-wrap">
              <label className="inline-flex items-center gap-1.5 text-muted">
                to
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  className="font-sans text-[0.75rem] px-2 py-0.5 border border-line rounded-full bg-paper text-ink focus:outline-none focus:border-accent"
                  aria-label="Move this trip to"
                >
                  {moveTargets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {sourceLabel(s.id)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                  if (moveTo) onMove(moveTo);
                }}
                className="p-0 border-0 bg-transparent text-accent-ink font-semibold cursor-pointer underline underline-offset-[3px]"
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="p-0 border-0 bg-transparent text-muted cursor-pointer"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The tool's front door: the trips, grouped by the source they are kept on,
 * each showing how much of it has been told. Deleting is a two-step confirm
 * inside the card — the same pattern as the studio gallery, no modal.
 *
 * A connected instance's list is asked for beside the local one and merged
 * by id: a trip mirrored here is one card, a trip only there is a greyed
 * card that pulls on open. While the instance answers, the mirrored ones
 * show with "checking…"; when it cannot, the header says so and the mirrors
 * stay — never hidden.
 */
export default function TripGallery({
  openTripId,
  onOpen,
  timelineSources,
  onSeedFrom,
  onChangeOpenTrip,
}: TripGalleryProps) {
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteLists, setRemoteLists] = useState<Record<string, RemoteList>>({});
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [covering, setCovering] = useState<TripDoc | null>(null);

  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const documentSources = useMemo(() => documentSourcesFor(connections), [connections]);
  // `handleImport` is declared further down and is a fresh function on every
  // render, so the bar reads it through a ref rather than listing it as a
  // dependency — the same shape the transport and dialog keys use.
  const handleImportRef = useRef<(sourceId: string) => Promise<void>>(async () => {});
  // On a phone the gallery's two verbs go in the thumb zone rather than in a
  // header row that has to share its line with the title. They are STARTING
  // points, not sections, so the shell adds its own Library cell beside them
  // and drops the app-bar button — see `SectionBarRole`.
  const compact = useIsCompact();
  usePublishSectionBar(
    useMemo(
      () =>
        compact
          ? {
              sections: [
                { id: 'new', label: 'New trip' },
                { id: 'import', label: 'Import' },
              ],
              active: null,
              label: 'Start a trip',
              role: 'actions' as const,
              onSelect: (id: string) => {
                if (id === 'new') setCreating(true);
                else if (documentSources.length > 1) setImporting(true);
                else void handleImportRef.current(DEFAULT_SOURCE_ID);
              },
            }
          : null,
      [compact, documentSources.length],
    ),
  );
  const remoteSourceIds = useMemo(
    () => documentSources.filter((s) => isRemoteSource(s.id)).map((s) => s.id),
    [documentSources],
  );

  const { urls, hasThumb } = useCoverThumbs(trips);

  const refresh = useCallback(() => {
    void listTrips().then(setTrips);
    for (const id of remoteSourceIds) {
      const remote = remoteFor(id);
      if (!remote) continue;
      setRemoteLists((cur) => ({ ...cur, [id]: { status: 'loading' } }));
      void listRemoteTrips(remote).then(
        (rows) => setRemoteLists((cur) => ({ ...cur, [id]: { status: 'ok', rows } })),
        (err: unknown) => {
          const e = explainFailure(failureOf(err), remote);
          setRemoteLists((cur) => ({ ...cur, [id]: { status: 'failed', ...e } }));
        },
      );
    }
  }, [remoteSourceIds]);

  useEffect(refresh, [refresh]);

  const setBusyFor = (id: string, text: string | null) =>
    setBusy((cur) => {
      const next = { ...cur };
      if (text === null) delete next[id];
      else next[id] = text;
      return next;
    });

  /**
   * A trip on an instance is written THERE first — one gesture, one request,
   * the result said. Nothing is kept here if the instance refused.
   */
  async function createOn(doc: TripDoc, verb: string): Promise<boolean> {
    if (!isRemoteSource(doc.sourceId)) {
      await putTrip(doc);
      return true;
    }
    const remote = remoteFor(doc.sourceId);
    if (!remote) {
      setNotice(`${doc.sourceId} is not connected — nothing was ${verb}.`);
      return false;
    }
    const rec = await pushTrip(remote, doc, null);
    if (rec.status !== 'synced') {
      await deleteSyncRecord(doc.id);
      const why = rec.error ? `: ${rec.error}` : '';
      setNotice(`Could not save to ${remote.label}${why} — nothing was ${verb}.`);
      return false;
    }
    await putTrip(doc);
    return true;
  }

  async function handleCreate(choices: TripDetails) {
    setNotice(null);
    // The two ends, with the empty ones dropped: filled they seed one leg over
    // the whole trip, empty they seed nothing at all — see `createTripDoc`.
    const places = [choices.from, choices.to].filter((p) => p.name.trim().length > 0);
    const doc = createTripDoc(
      choices.name,
      choices.destination,
      choices.startDate,
      choices.endDate,
      places,
      choices.sourceId,
    );
    setCreating(false);
    if (await createOn(doc, 'created')) onOpen(doc);
  }

  /** The whole trip on disk — a backup, and how it reaches another machine. */
  function handleExport(trip: TripDoc) {
    downloadBlob(
      new Blob([serializeTripFile(toTripFile(trip))], { type: 'application/json' }),
      tripFileName(trip.name),
    );
  }

  /**
   * A trip file always becomes a NEW trip, never an overwrite: importing the
   * same backup twice must not silently replace the trip you have been telling
   * for months. Merging two trips is not a thing this offers, deliberately.
   */
  async function handleImport(targetSourceId: string) {
    const picked = await pickFile(TRIP_FILE_ACCEPT);
    if (!picked) return;
    setNotice(null);
    const parsed = parseTripFile(await picked.text());
    if (!parsed.ok) {
      setNotice(parsed.error);
      return;
    }
    const target = documentSources.some((s) => s.id === targetSourceId)
      ? targetSourceId
      : DEFAULT_SOURCE_ID;
    const doc = tripDocFromFile(parsed.file, Date.now(), target);
    if (!doc.name.trim()) {
      doc.name = picked.name.replace(/\.(roadtrip\.)?json$/i, '') || 'Imported trip';
    }
    if (await createOn(doc, 'imported')) refresh();
  }
  handleImportRef.current = handleImport;

  /**
   * Delete here, and there when the trip is kept on an instance — guarded
   * by the revision this device holds, and refused while the instance cannot
   * be reached: a delete that lands later is a tombstone, and there are none.
   */
  async function handleDelete(trip: TripDoc, etagHint: string | null) {
    setNotice(null);
    if (isRemoteSource(trip.sourceId)) {
      const remote = remoteFor(trip.sourceId);
      if (!remote) {
        setNotice(`Connect ${trip.sourceId} to delete this trip — it is kept there.`);
        return;
      }
      setBusyFor(trip.id, `deleting on ${remote.label}…`);
      const etag = etagHint ?? (await getSyncRecord(trip.id))?.etag ?? null;
      try {
        await deleteRemoteTrip(remote, trip.id, etag);
      } catch (err) {
        const f = failureOf(err);
        if (f.kind !== 'notfound') {
          setBusyFor(trip.id, null);
          const e = explainFailure(f, remote);
          setNotice(
            f.kind === 'unreachable'
              ? `Connect to ${remote.label} to delete this trip — it is kept there.`
              : `Could not delete on ${remote.label}: ${e.text}`,
          );
          return;
        }
        // Already gone there: deleting the mirror is exactly what remains.
      }
    }
    // The hooks go with the trip: nothing else will ever prune them, and they
    // are the only heavy values in the database.
    await deleteTrip(trip.id);
    await deleteThumbs(trip.posts.map((p) => p.id));
    await deleteSyncRecord(trip.id);
    setBusyFor(trip.id, null);
    refresh();
  }

  /**
   * A cover is a trip edit made from the gallery, so it takes the same road a
   * creation does: written where the trip is KEPT first, mirrored here after.
   * The open trip is handed back to the tool instead — its save machine holds
   * that document and would flush over anything written behind it.
   */
  async function handleCover(trip: TripDoc, cover: TripCover) {
    setCovering(null);
    setNotice(null);
    const next: TripDoc = { ...trip, cover, updatedAt: Date.now() };
    if (onChangeOpenTrip && trip.id === openTripId) {
      onChangeOpenTrip(next);
      setTrips((cur) => cur?.map((t) => (t.id === next.id ? next : t)) ?? cur);
      return;
    }
    if (isRemoteSource(next.sourceId)) {
      const remote = remoteFor(next.sourceId);
      if (!remote) {
        setNotice(`Connect ${next.sourceId} to change this cover — the trip is kept there.`);
        return;
      }
      setBusyFor(next.id, `saving on ${remote.label}…`);
      const rec = await pushTrip(remote, next, (await getSyncRecord(next.id)) ?? null);
      setBusyFor(next.id, null);
      if (rec.status !== 'synced') {
        const why = rec.error ? `: ${rec.error}` : '';
        setNotice(`Could not save to ${remote.label}${why} — the cover is unchanged.`);
        return;
      }
    }
    await putTrip(next);
    refresh();
  }

  async function handleMove(trip: TripDoc, targetSourceId: string) {
    setNotice(null);
    setBusyFor(trip.id, `moving to ${sourceLabel(targetSourceId)}…`);
    const r = await moveTrip(trip, targetSourceId);
    setBusyFor(trip.id, null);
    if (!r.ok) setNotice(r.error);
    refresh();
  }

  /** A trip kept there and not here yet: pull, mirror, then open. */
  async function handleOpenRemote(row: RemoteTripRow) {
    setNotice(null);
    setBusyFor(row.doc.id, `fetching from ${sourceLabel(row.doc.sourceId)}…`);
    await mirrorTrip(row.doc.sourceId, row.doc, row.etag);
    setBusyFor(row.doc.id, null);
    onOpen(row.doc);
  }

  // One group per source: the local ones from `groupBySource`, plus every
  // connected instance with a bucket even when nothing of it is mirrored yet,
  // so its header can say "checking…" or why it could not answer.
  const groups = useMemo(() => {
    if (trips === null) return [];
    const base = groupBySource(trips);
    const seen = new Set(base.map((g) => g.id));
    for (const id of remoteSourceIds) {
      if (!seen.has(id)) base.push({ id, items: [] });
    }
    return base.map((g) => {
      const list = remoteLists[g.id];
      const mirrored = new Set(g.items.map((t) => t.id));
      const remoteOnly =
        list?.status === 'ok' ? list.rows.filter((r) => !mirrored.has(r.doc.id)) : [];
      return { ...g, list, remoteOnly };
    });
  }, [trips, remoteSourceIds, remoteLists]);

  const nothingAnywhere =
    trips !== null && groups.every((g) => g.items.length === 0 && g.remoteOnly.length === 0);

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-5 overflow-auto"
      aria-label="Trips"
    >
      {/* The masthead already says "Atelier / Trips" at every width, so the
          page does not draw the name a second time — on a phone that pair of
          lines was the top fifth of the screen, above the trips it names. The
          heading stays in the document for a screen reader and an outline;
          only its ink is given back. */}
      <h1 className="sr-only">Trips</h1>
      {/* On a phone these two verbs live in the shell's bottom bar instead,
          where a thumb reaches them — offering them in both places would be
          the same verb twice on one screen — so the row itself goes with them
          rather than leaving an empty one above the cards. */}
      {!compact && (
        <div className="flex items-center justify-end gap-4 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (documentSources.length > 1) setImporting(true);
              else void handleImport(DEFAULT_SOURCE_ID);
            }}
            className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-line-strong rounded-full bg-paper text-ink-soft cursor-pointer text-[0.84rem] transition-colors hover:border-accent hover:text-accent-ink"
            title={`Create a trip from an exported file (${TRIP_FILE_EXTENSION})`}
          >
            ↑ Import a trip file
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-[transform,background-color,color] duration-200 ease-paper hover:bg-accent hover:border-accent active:scale-[0.98]"
          >
            + New trip
          </button>
        </div>
      )}

      {notice && (
        <p className="m-0 text-[0.8rem] text-[#9a3a23]" role="alert">
          {notice}
        </p>
      )}

      {trips === null ? (
        <p className="m-0 text-[0.85rem] text-muted font-mono">Loading trips…</p>
      ) : nothingAnywhere && remoteSourceIds.every((id) => remoteLists[id]?.status === 'ok') ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-[44ch] flex flex-col items-center gap-3 border border-dashed border-line-strong rounded-paper-lg px-8 py-10">
            <p className="m-0 font-serif text-[1.25rem]">No trips yet</p>
            <p className="m-0 text-[0.85rem] text-muted leading-relaxed">
              Give a trip its two dates and every photo you post from it knows
              which day it belongs to — and the grid shows the days you have
              never told.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 px-[1.1rem] py-2 inline-flex items-center gap-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold hover:bg-accent hover:border-accent"
            >
              Create the first one
            </button>
          </div>
        </div>
      ) : (
        // Grouped by provenance — one group per source, `local` first, even
        // while local is the only one: the studio gallery's own shape, so a
        // trip kept on a Winnow lands in its own section instead of reshaping
        // this page. A source this session does not know still shows its
        // trips, with the reason — never hidden.
        <div className="flex flex-col gap-6 pb-4">
          {groups.map(({ id, items, list, remoteOnly }) => {
            const source = sourceById(id);
            const count = items.length + remoteOnly.length;
            const moveTargets = documentSources.filter((s) => s.id !== id);
            return (
              <section key={id} aria-label={`Trips from ${source?.label ?? id}`}>
                <p className="m-0 mb-3 font-mono text-[0.66rem] tracking-[0.14em] uppercase text-muted">
                  source: {source?.label ?? id}
                  <span className="text-faint"> · </span>
                  <span className="tabular-nums">
                    {count} trip{count === 1 ? '' : 's'}
                  </span>
                  {!source && (
                    <span className="text-faint">
                      {' '}
                      · not connected — showing what this device holds
                    </span>
                  )}
                  {list?.status === 'loading' && <span className="text-faint"> · checking…</span>}
                  {list?.status === 'failed' && (
                    <span className="text-faint normal-case tracking-normal">
                      {' '}
                      · {list.text}
                      {list.login && (
                        <>
                          {' '}
                          <a
                            href={list.login}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-ink underline underline-offset-[3px]"
                          >
                            Sign in
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </p>
                {count === 0 ? (
                  <p className="m-0 text-[0.8rem] text-faint">Nothing kept here yet.</p>
                ) : (
                  <div
                    className={
                      // Two columns on a phone: the 260px minimum below gives
                      // exactly one on a 374px content width, and a column of
                      // single cards wastes the half of the screen a trip's
                      // cover does not need. Above compact the auto-fill track
                      // takes over again.
                      compact
                        ? 'grid grid-cols-2 gap-3'
                        : 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5'
                    }
                  >
                    {items.map((trip) => (
                      <TripCard
                        key={trip.id}
                        trip={trip}
                        isOpen={trip.id === openTripId}
                        remoteOnly={false}
                        moveTargets={moveTargets}
                        busy={busy[trip.id] ?? null}
                        urls={urls}
                        hasThumb={hasThumb}
                        onOpen={() => onOpen(trip)}
                        onExport={() => handleExport(trip)}
                        onDelete={() => void handleDelete(trip, null)}
                        onMove={(target) => void handleMove(trip, target)}
                        onChooseCover={() => setCovering(trip)}
                      />
                    ))}
                    {remoteOnly.map((row) => (
                      <TripCard
                        key={row.doc.id}
                        trip={row.doc}
                        isOpen={false}
                        remoteOnly
                        moveTargets={[]}
                        busy={busy[row.doc.id] ?? null}
                        urls={urls}
                        hasThumb={hasThumb}
                        onOpen={() => void handleOpenRemote(row)}
                        onExport={() => handleExport(row.doc)}
                        onDelete={() => void handleDelete(row.doc, row.etag)}
                        onMove={() => undefined}
                        onChooseCover={() => setCovering(row.doc)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {covering && (
        <TripCoverModal
          trip={covering}
          onCancel={() => setCovering(null)}
          onSave={(cover) => void handleCover(covering, cover)}
        />
      )}

      {importing && (
        <ImportTripModal
          sources={documentSources}
          onCancel={() => setImporting(false)}
          onChooseFile={(target) => {
            setImporting(false);
            void handleImport(target);
          }}
        />
      )}

      {creating && (
        <TripDetailsModal
          sources={documentSources}
          onCancel={() => setCreating(false)}
          onSubmit={(choices) => void handleCreate(choices)}
          timelineSources={timelineSources}
          onSeedFrom={
            onSeedFrom
              ? (id) => {
                  setCreating(false);
                  onSeedFrom(id);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
