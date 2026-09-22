import { useCallback, useMemo, useRef, useState } from 'react';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import { tripRouteLabel } from '../../shared/roadtrip/trip-places';
import { tripCoverage, type TripCoverage } from '../../shared/roadtrip/trip-coverage';
import {
  coverTiles,
  rhythmBuckets,
  rhythmLevel,
  type CoverTile,
} from '../../shared/roadtrip/trip-cover';
import { createTripDoc, type TripCover, type TripDoc } from '../../shared/roadtrip/trip-types';
import { applyHouseStyle } from '../../shared/roadtrip/house-style';
import { bundledHouseStyle } from '../../shared/roadtrip/house-style-bundle';
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
import { DEFAULT_SOURCE_ID, sourceById, type SourceInfo } from '../../shared/sources/source';
import { sourceLabel } from '../../shared/sources/document-gallery';
import AbsentSourceNotes from '../../shared/sources/AbsentSourceNotes';
import { useDocumentGallery } from '../../shared/sources/use-document-gallery';
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
  TRIP_DOC_KIND,
  deleteRemoteTrip,
  isRemoteSource,
  listRemoteTrips,
  mirrorTrip,
  moveTrip,
  pushTrip,
  remoteFor,
  type RemoteTripRow,
} from '../../shared/roadtrip/trip-remote';
import TripDetailsModal, { type TripDetails, type TimelineSourceOption } from './TripDetailsModal';
import ImportDocumentModal from '../../shared/ui/ImportDocumentModal';
import TripCoverModal from './TripCoverModal';
import { HEATMAP_LEVELS } from './heatmap-ramp';
import useCoverThumbs from './use-cover-thumbs';
import { pageScroll } from '../../shared/ui/page-scroll';
import { usePublishSectionBar } from '../../shared/ui/section-rail';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import Button from '../../shared/ui/Button';
import LoadingState from '../../shared/ui/LoadingState';
import EmptyState from '../../shared/ui/EmptyState';
import ConfirmDialog from '../../shared/ui/ConfirmDialog';
import { Icons } from '../../shared/ui/icons';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import Segmented from '../../shared/ui/Segmented';

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

/** The trip this browser opened last (`TripCard`'s "last opened" tag). */
const LAST_OPENED_KEY = 'atelier.roadtrip.lastOpened';
/** Cards or Bands — the maintainer wanted both, and the cover kept. */
const VIEW_KEY = 'atelier.roadtrip.gallery.view';
type GalleryView = 'cards' | 'bands';

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
      <p className="m-0 font-mono text-2xs tracking-[0.08em] uppercase text-muted truncate">
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
          <p className="m-0 font-mono text-2xs tracking-[0.08em] uppercase text-faint text-center leading-[1.7]">
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
      <span className="absolute left-3 bottom-2.5 font-mono text-2xs tracking-[0.1em] uppercase text-paper [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
        {tileCaption(tiles[0])}
      </span>
    </div>
  );
}

/**
 * A trip's verbs, wherever the trip is drawn — a card, a row, the resume
 * band: the ⋯ menu and the two questions it can ask. One component, so the
 * Bands view cannot offer a different set from the Cards view.
 */
function TripActions({
  trip,
  isOpen,
  remoteOnly,
  moveTargets,
  onOpen,
  onExport,
  onDelete,
  onMove,
  onChooseCover,
  size = 'sm',
}: {
  trip: TripDoc;
  isOpen: boolean;
  remoteOnly: boolean;
  moveTargets: readonly SourceInfo[];
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove: (targetSourceId: string) => void;
  onChooseCover: () => void;
  size?: 'sm' | 'md';
}) {
  const [confirming, setConfirming] = useState<
    { kind: 'delete' } | { kind: 'move'; to: SourceInfo } | null
  >(null);

  // The ⋯ menu is the ONLY home of the cover chooser on a card: the chip that
  // used to sit on the cover kept swallowing the click meant for the trip.
  const items: OverflowItem[] = [
    { id: 'open', label: isOpen ? 'Resume' : remoteOnly ? 'Open here' : 'Open', onSelect: onOpen },
    { id: 'cover', label: 'Choose a cover…', onSelect: onChooseCover },
    {
      id: 'export',
      label: 'Export the trip file',
      title: `Save the whole trip as a ${TRIP_FILE_EXTENSION} file`,
      onSelect: onExport,
    },
    ...(!remoteOnly
      ? moveTargets.map((target) => ({
          id: `move:${target.id}`,
          label: `Keep on ${sourceLabel(target.id)}…`,
          onSelect: () => setConfirming({ kind: 'move', to: target }),
        }))
      : []),
    { id: 'delete', label: 'Delete this trip…', danger: true, onSelect: () => setConfirming({ kind: 'delete' }) },
  ];

  return (
    <>
      <OverflowMenu label={`More actions for ${trip.name}`} items={items} size={size} className="-mr-1.5" />
      {confirming?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${trip.name}”?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onDelete();
          }}
        >
          <p>
            Its days, stages and pieces go with it, for good. An exported
            .roadtrip.json is the only copy that would survive.
          </p>
        </ConfirmDialog>
      )}
      {confirming?.kind === 'move' && (
        <ConfirmDialog
          title={`Keep “${trip.name}” on ${sourceLabel(confirming.to.id)}?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const to = confirming.to.id;
            setConfirming(null);
            onMove(to);
          }}
        >
          <p>
            The trip will be kept there from now on and resume from any device
            connected to it. Its pictures never travel with it.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** The one line under a trip's name: told, published, and the silence. */
function ProgressLine({ coverage, className = '' }: { coverage: TripCoverage; className?: string }) {
  const total = coverage.totalDays;
  return (
    <p className={`m-0 text-xs text-ink-soft tabular-nums ${className}`}>
      <span className="font-mono">{coverage.toldDays}</span> / {total} day
      {total === 1 ? '' : 's'} told
      {coverage.publishedPosts > 0 && (
        <>
          <span className="text-faint"> · </span>
          {coverage.publishedPosts} published
        </>
      )}
      {coverage.toldDays > 0 && coverage.longestGap && coverage.longestGap.length >= 3 && (
        <>
          <span className="text-faint"> · </span>
          <span className="text-accent-ink">{coverage.longestGap.length} of silence</span>
        </>
      )}
    </p>
  );
}

/**
 * The trip's days as a strip of cells: one per day up to two months, then
 * bucketed exactly as the card's rhythm band is (`rhythmBuckets`), on the
 * grid's own five-rung ramp — a row and the overview must not disagree about
 * a day.
 */
function DayStrip({ coverage, className = '' }: { coverage: TripCoverage; className?: string }) {
  const bars = rhythmBuckets(coverage, Math.min(62, coverage.totalDays));
  return (
    <div className={`flex gap-px h-full ${className}`} aria-hidden="true">
      {bars.map((bar) => (
        <span
          key={bar.from}
          className="flex-1 min-w-0 rounded-[1px]"
          style={{ background: HEATMAP_LEVELS[rhythmLevel(bar)] }}
          title={`${formatIsoDate(bar.from)}${bar.days > 1 ? ` → ${formatIsoDate(bar.to)}` : ''} · ${bar.told}/${bar.days} told`}
        />
      ))}
    </div>
  );
}

/** A row of the Bands view: name, dates, the strip, the progress. */
function TripRow({
  trip,
  isOpen,
  remoteOnly,
  moveTargets,
  busy,
  onOpen,
  onExport,
  onDelete,
  onMove,
  onChooseCover,
}: {
  trip: TripDoc;
  isOpen: boolean;
  remoteOnly: boolean;
  moveTargets: readonly SourceInfo[];
  busy: string | null;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove: (targetSourceId: string) => void;
  onChooseCover: () => void;
}) {
  const coverage = tripCoverage(trip);
  const route = tripRouteLabel(trip);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${trip.name}`}
      onClick={(e) => {
        if (busy !== null) return;
        if ((e.target as HTMLElement).closest('button, a, [role="menu"]')) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (busy === null) onOpen();
        }
      }}
      className={`grid grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 px-3 py-2.5 border-b border-line cursor-pointer transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
        remoteOnly ? 'opacity-75' : ''
      } ${isOpen ? 'bg-accent-wash/50' : ''}`}
    >
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-semibold truncate" title={trip.name}>
          {trip.name}
        </span>
        <span className="font-mono text-2xs text-muted tabular-nums truncate">
          {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
          {route && <span className="font-sans"> · {route}</span>}
        </span>
      </div>
      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="h-3">
          <DayStrip coverage={coverage} />
        </div>
        {busy ? (
          <p className="m-0 font-mono text-2xs text-muted" role="status">
            {busy}
          </p>
        ) : (
          <ProgressLine coverage={coverage} className="text-2xs" />
        )}
      </div>
      {busy === null && (
        <TripActions
          trip={trip}
          isOpen={isOpen}
          remoteOnly={remoteOnly}
          moveTargets={moveTargets}
          onOpen={onOpen}
          onExport={onExport}
          onDelete={onDelete}
          onMove={onMove}
          onChooseCover={onChooseCover}
        />
      )}
    </div>
  );
}

/**
 * The band at the top of the Bands view: the trip you were on, with the one
 * verb that matters (Resume) and the sentence the whole tool exists for —
 * how much is told, and how long the silence has run.
 */
function ResumeBand({
  trip,
  isOpen,
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
  moveTargets: readonly SourceInfo[];
  busy: string | null;
  urls: ReadonlyMap<string, string>;
  hasThumb: (postId: string) => boolean;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMove: (targetSourceId: string) => void;
  onChooseCover: () => void;
}) {
  const coverage = tripCoverage(trip);
  const tiles = coverTiles(trip, coverage, hasThumb);
  const lead = tiles[0] ? urls.get(tiles[0].postId) : undefined;
  const gap = coverage.longestGap;
  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 p-4 mb-3 bg-surface border rounded-paper-lg shadow-paper-soft ${
        isOpen ? 'border-accent' : 'border-line'
      }`}
    >
      <div className="row-span-3 w-[7.5rem] h-[5.25rem] rounded-[10px] overflow-hidden bg-paper-2">
        {lead ? (
          <img src={lead} alt="" className="block w-full h-full object-cover" />
        ) : (
          <div className="p-2 h-full">
            <DayStrip coverage={coverage} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex items-baseline gap-2.5 flex-wrap">
        <span className="font-serif text-xl leading-tight truncate">{trip.name}</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)} · {coverage.totalDays} day
          {coverage.totalDays === 1 ? '' : 's'}
        </span>
        <span
          className={`font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] ${
            isOpen ? 'bg-accent-wash text-accent-ink' : 'bg-paper-2 text-muted'
          }`}
        >
          {isOpen ? 'open' : 'last opened'}
        </span>
      </div>
      <div className="row-span-3 flex items-center gap-2">
        <Button variant="primary" onClick={onOpen} disabled={busy !== null}>
          {isOpen ? 'Resume' : 'Open'}
        </Button>
        {busy === null && (
          <TripActions
            trip={trip}
            isOpen={isOpen}
            remoteOnly={false}
            moveTargets={moveTargets}
            onOpen={onOpen}
            onExport={onExport}
            onDelete={onDelete}
            onMove={onMove}
            onChooseCover={onChooseCover}
            size="md"
          />
        )}
      </div>
      <div className="h-5">
        <DayStrip coverage={coverage} />
      </div>
      {busy ? (
        <p className="m-0 font-mono text-2xs text-muted" role="status">
          {busy}
        </p>
      ) : (
        <p className="m-0 text-sm text-ink-soft tabular-nums">
          <strong className="font-semibold text-ink">
            {coverage.toldDays} day{coverage.toldDays === 1 ? '' : 's'} told of {coverage.totalDays}
          </strong>
          {coverage.publishedPosts > 0 && <> · {coverage.publishedPosts} published</>}
          {gap && gap.length >= 2 && (
            <>
              {' · '}
              <span className="text-accent-ink">
                {gap.length} day{gap.length === 1 ? '' : 's'} of silence since {formatIsoDate(gap.start)}
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function TripCard({
  trip,
  isOpen,
  lastOpened,
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
  /** The trip this browser opened last — where "resume" would land. */
  lastOpened: boolean;
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
  const compact = useIsCompact();
  const coverage = tripCoverage(trip);
  const route = tripRouteLabel(trip);
  const total = coverage.totalDays;
  const pct = total > 0 ? Math.round((coverage.toldDays / total) * 100) : 0;
  const tiles = coverTiles(trip, coverage, hasThumb);

  return (
    <div
      // The whole card opens the trip — a card that shows a trip's name, its
      // dates and how much of it is told is the thing you point at. Anything
      // already interactive keeps its own click, through one guard rather
      // than `stopPropagation` sprinkled over every control.
      role="button"
      tabIndex={0}
      aria-label={`Open ${trip.name}`}
      onClick={(e) => {
        if (busy !== null) return;
        if ((e.target as HTMLElement).closest('button, select, input, label, a, [role="menu"]')) {
          return;
        }
        onOpen();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          if (busy === null) onOpen();
        }
      }}
      className={`relative flex flex-col bg-surface border rounded-paper-lg shadow-paper-soft transition-[box-shadow,border-color] duration-300 ease-paper hover:shadow-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        busy === null ? 'cursor-pointer' : ''
      } ${isOpen ? 'border-accent' : 'border-line hover:border-line-strong'} ${
        remoteOnly ? 'opacity-75' : ''
      }`}
    >
      {/* The card no longer clips (its ⋯ menu opens past its edge), so the
          cover rounds its own top corners. */}
      <div className="relative rounded-t-paper-lg overflow-hidden">
        <CoverArt
          trip={trip}
          coverage={coverage}
          tiles={tiles}
          urls={urls}
          remoteOnly={remoteOnly}
        />
        {remoteOnly && trip.cover.layout !== 'none' && (
          <span className="absolute top-2.5 right-2.5 px-2 py-[3px] rounded-[6px] border font-mono text-3xs tracking-[0.08em] uppercase bg-[rgba(251,248,241,0.92)] border-line text-muted">
            not here yet
          </span>
        )}
        {/* No `Cover` chip on the picture: the cover zone IS the card's click
            target, and a verb sitting on it caught the press meant for the
            trip — reaching for the card and landing in the cover chooser. The
            ⋯ menu carries the verb at every layout, which is also what keeps a
            `none` cover from being a one-way door. */}
      </div>

      <div className={`flex flex-col ${compact ? 'gap-2 p-3.5' : 'gap-2.5 p-4'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <h3
            className={`m-0 min-w-0 font-semibold truncate ${compact ? 'text-sm' : 'text-base'}`}
            title={trip.name}
          >
            {trip.name}
          </h3>
          {/* Where you were: the trip this browser opened last, or the one
              open right now. One tag, never both — "open" wins. */}
          {(isOpen || lastOpened) && (
            <span
              className={`flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] ${
                isOpen ? 'bg-accent-wash text-accent-ink' : 'bg-paper-2 text-muted'
              }`}
            >
              {isOpen ? 'open' : 'last opened'}
            </span>
          )}
          <span className="flex-1" />
          {busy === null && (
            <TripActions
              trip={trip}
              isOpen={isOpen}
              remoteOnly={remoteOnly}
              moveTargets={moveTargets}
              onOpen={onOpen}
              onExport={onExport}
              onDelete={onDelete}
              onMove={onMove}
              onChooseCover={onChooseCover}
            />
          )}
        </div>

        {/* The span and the route on one line. The route is DERIVED from the
            legs (`tripRouteLabel`) rather than stored, so it follows them; a
            trip with no leg draws none — a field with nothing in it is not a
            fact. */}
        <p className={`m-0 text-muted truncate ${compact ? 'text-2xs' : 'text-xs'}`}>
          <span className="font-mono tabular-nums">
            {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
          </span>
          {route && (
            <>
              <span className="text-faint"> · </span>
              {route}
            </>
          )}
        </p>

        {/* Progress reads as "how much of the trip has been told", which is the
            number the maintainer actually tracks — not how many files exist. */}
        <div>
          <div className="h-[5px] rounded-full bg-paper-2 overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-500 ease-paper"
              style={{ width: `${pct}%` }}
            />
          </div>
          <ProgressLine coverage={coverage} className="mt-1.5" />
        </div>

        {busy && (
          <p className="m-0 font-mono text-2xs text-muted" role="status">
            {busy}
          </p>
        )}
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
  const [creating, setCreating] = useState(false);
  // Cards (the cover, the default) or Bands (progress rows under a resume
  // band). A reading preference of this browser: never on the document.
  const [view, setView] = useState<GalleryView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'bands' ? 'bands' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const chooseView = (next: GalleryView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode */
    }
  };
  // Where you were: the trip this browser opened last, so the gallery can
  // point at it when nothing is open. A reading preference of this browser —
  // never on the document, never in the file.
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_OPENED_KEY);
    } catch {
      return null;
    }
  });
  // Written on the way OUT: the gallery is unmounted while a trip is open,
  // so watching `openTripId` from here would never see it.
  const open = useCallback(
    (trip: TripDoc) => {
      setLastOpenedId(trip.id);
      try {
        localStorage.setItem(LAST_OPENED_KEY, trip.id);
      } catch {
        /* private mode: the tag is a convenience */
      }
      onOpen(trip);
    },
    [onOpen],
  );
  const [importing, setImporting] = useState(false);
  const [covering, setCovering] = useState<TripDoc | null>(null);

  // The lists, the groups and the verbs that cross a source are shared with
  // every document gallery (`use-document-gallery.ts`); this driver says how a
  // trip is listed, written and removed — its hook thumbnails go with it.
  const gallery = useDocumentGallery<TripDoc, RemoteTripRow>({
    kind: TRIP_DOC_KIND,
    noun: 'trip',
    listLocal: listTrips,
    listRemote: listRemoteTrips,
    putDoc: putTrip,
    pushNew: (remote, doc) => pushTrip(remote, doc, null),
    getRecord: getSyncRecord,
    deleteRecord: deleteSyncRecord,
    deleteRemote: deleteRemoteTrip,
    deleteLocal: async (trip) => {
      await deleteTrip(trip.id);
      // The hooks go with the trip: nothing else will ever prune them, and
      // they are the only heavy values in the database.
      await deleteThumbs(trip.posts.map((p) => p.id));
    },
    mirror: mirrorTrip,
    move: moveTrip,
  });
  const {
    docs: trips,
    setDocs: setTrips,
    documentSources,
    refresh,
    groups,
    absent,
    nothingAnywhere,
    allListed,
    busy,
    setBusyFor,
    notice,
    setNotice,
    createOn,
  } = gallery;
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
  const { urls, hasThumb } = useCoverThumbs(trips);

  async function handleCreate(choices: TripDetails) {
    setNotice(null);
    // A new trip wears the house style when one is committed; a backup or an
    // existing trip never does (`house-style.ts`).
    const doc = applyHouseStyle(
      createTripDoc(choices.name, choices.startDate, choices.endDate, choices.sourceId),
      bundledHouseStyle(),
    );
    setCreating(false);
    if (await createOn(doc, 'created')) open(doc);
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
    await gallery.remove(trip, etagHint);
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
    await gallery.moveTo(trip, targetSourceId);
  }

  /** A trip kept there and not here yet: pull, mirror, then open. */
  async function handleOpenRemote(row: RemoteTripRow) {
    open(await gallery.mirrorRemote(row));
  }

  return (
    <section
      // The shell leaves no gutter between the fixed masthead and this
      // scroller, on purpose (`App.tsx`): a gap there is paper the content
      // gets clipped against. Breathing room belongs HERE instead, where it
      // scrolls away with the first row rather than holding it off the edge.
      className={`${pageScroll} ${compact ? 'pt-3' : ''}`}
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
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-serif text-2xl leading-none" aria-hidden="true">
            Trips
          </span>
          {trips !== null && (
            <span className="font-mono text-xs text-muted tabular-nums">{trips.length}</span>
          )}
          <span className="flex-1" />
          <Segmented
            label="How the trips are shown"
            value={view}
            onChange={chooseView}
            options={[
              { id: 'cards', label: 'Cards', icon: Icons.grid, title: 'Each trip as a card with its cover' },
              { id: 'bands', label: 'Bands', icon: Icons.rows, title: 'Progress rows, the trip you were on first' },
            ]}
          />
          <Button
            onClick={() => {
              if (documentSources.length > 1) setImporting(true);
              else void handleImport(DEFAULT_SOURCE_ID);
            }}
            icon={Icons.import}
            title={`Create a trip from an exported file (${TRIP_FILE_EXTENSION})`}
          >
            Import
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)} icon={Icons.plus}>
            New trip
          </Button>
        </div>
      )}

      {notice && (
        <p className="m-0 text-xs text-danger" role="alert">
          {notice}
        </p>
      )}

      <AbsentSourceNotes absent={absent} />

      {trips === null ? (
        <LoadingState label="Loading trips…" />
      ) : nothingAnywhere && allListed ? (
        <EmptyState
          title="No trips yet"
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create the first one
            </Button>
          }
        >
          Give a trip its two dates and every photo you post from it knows which
          day it belongs to — and the grid shows the days you have never told.
        </EmptyState>
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
                <p className="m-0 mb-3 font-mono text-2xs tracking-[0.14em] uppercase text-muted">
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
                  <p className="m-0 text-xs text-faint">Nothing kept here yet.</p>
                ) : view === 'bands' && !compact ? (
                  (() => {
                    // The trip you were on leads the band — open, else last
                    // opened — and the rest follow as rows.
                    const leadId =
                      items.find((t) => t.id === openTripId)?.id ??
                      items.find((t) => t.id === lastOpenedId)?.id ??
                      null;
                    const lead = items.find((t) => t.id === leadId) ?? null;
                    const rest = items.filter((t) => t.id !== leadId);
                    return (
                      <div className="flex flex-col">
                        {lead && (
                          <ResumeBand
                            trip={lead}
                            isOpen={lead.id === openTripId}
                            moveTargets={moveTargets}
                            busy={busy[lead.id] ?? null}
                            urls={urls}
                            hasThumb={hasThumb}
                            onOpen={() => open(lead)}
                            onExport={() => handleExport(lead)}
                            onDelete={() => void handleDelete(lead, null)}
                            onMove={(target) => void handleMove(lead, target)}
                            onChooseCover={() => setCovering(lead)}
                          />
                        )}
                        <div className="flex flex-col border-t border-line">
                          {rest.map((trip) => (
                            <TripRow
                              key={trip.id}
                              trip={trip}
                              isOpen={false}
                              remoteOnly={false}
                              moveTargets={moveTargets}
                              busy={busy[trip.id] ?? null}
                              onOpen={() => open(trip)}
                              onExport={() => handleExport(trip)}
                              onDelete={() => void handleDelete(trip, null)}
                              onMove={(target) => void handleMove(trip, target)}
                              onChooseCover={() => setCovering(trip)}
                            />
                          ))}
                          {remoteOnly.map((row) => (
                            <TripRow
                              key={row.doc.id}
                              trip={row.doc}
                              isOpen={false}
                              remoteOnly
                              moveTargets={[]}
                              busy={busy[row.doc.id] ?? null}
                              onOpen={() => void handleOpenRemote(row)}
                              onExport={() => handleExport(row.doc)}
                              onDelete={() => void handleDelete(row.doc, row.etag)}
                              onMove={() => undefined}
                              onChooseCover={() => setCovering(row.doc)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })()
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
                        lastOpened={openTripId === null && trip.id === lastOpenedId}
                        remoteOnly={false}
                        moveTargets={moveTargets}
                        busy={busy[trip.id] ?? null}
                        urls={urls}
                        hasThumb={hasThumb}
                        onOpen={() => open(trip)}
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
                        lastOpened={false}
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
        <ImportDocumentModal
          title="Import a trip file"
          blurb={`Creates a new trip from an exported ${TRIP_FILE_EXTENSION} backup — it never overwrites one you already have.`}
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
