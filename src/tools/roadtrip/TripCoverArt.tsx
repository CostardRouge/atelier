import { formatIsoDate } from '../../shared/roadtrip/trip-days';
import type { TripCoverage } from '../../shared/roadtrip/trip-coverage';
import { rhythmBuckets, rhythmLevel, type CoverTile } from '../../shared/roadtrip/trip-cover';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { sourceLabel } from '../../shared/sources/document-gallery';
import { useIsCompact } from '../../shared/ui/use-layout-mode';
import { HEATMAP_LEVELS } from './heatmap-ramp';

/*
 * What a trip's card shows of itself — the gallery's cards and Trip settings'
 * Cover section draw it through this one component, so the preview in the
 * sheet IS the card (2026-10-09), never a second drawing of it.
 */

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

export function RhythmBand({ coverage, compact }: { coverage: TripCoverage; compact: boolean }) {
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
export default function CoverArt({
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
      <span className="absolute left-3 bottom-2.5 font-mono text-2xs tracking-[0.1em] uppercase text-on-media [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
        {tileCaption(tiles[0])}
      </span>
    </div>
  );
}
