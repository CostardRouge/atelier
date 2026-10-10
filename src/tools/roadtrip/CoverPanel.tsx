import { useEffect, useMemo, useRef, useState } from 'react';
import { tripCoverage } from '../../shared/roadtrip/trip-coverage';
import {
  COVER_TILES,
  type CoverLayout,
  type TripCover,
  type TripDoc,
} from '../../shared/roadtrip/trip-types';
import {
  coverTiles,
  dayNumberOf,
  droppedPins,
  rhythmBuckets,
  rhythmLevel,
  togglePin,
} from '../../shared/roadtrip/trip-cover';
import { getThumbs } from '../../shared/roadtrip/trip-store';
import { HEATMAP_LEVELS } from './heatmap-ramp';
import CoverArt from './TripCoverArt';
import { formatIsoDate } from '../../shared/roadtrip/trip-days';

interface CoverPanelProps {
  trip: TripDoc;
  value: TripCover;
  onChange: (cover: TripCover) => void;
}

const LAYOUTS: Array<{ id: CoverLayout; label: string; note: string }> = [
  {
    id: 'mosaic',
    label: 'Mosaic',
    note: 'Three pieces, so the trip reads as a place.',
  },
  { id: 'cover', label: 'Cover', note: 'One picture, filling the card.' },
  { id: 'rhythm', label: 'Rhythm', note: 'No picture: the trip’s own weeks.' },
  {
    id: 'none',
    label: 'None',
    note: 'The compact card, for a screen full of trips.',
  },
];

const legend = 'm-0 font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/**
 * Choosing what a trip shows of itself: the layout, and the pieces pinned to it.
 *
 * A controlled panel, drawn by Trip settings' Cover section — the one sheet
 * of the trip's own properties, reached from the overview, a piece and the
 * gallery card alike (its «Trip settings…» opens the trip on this section).
 *
 * Every thumbnail of the trip is loaded here rather than the handful a card
 * needs: the point of the panel is to see the pieces and pick among them. They
 * are revoked on unmount — a sheet opened deliberately may hold a few
 * megabytes; a gallery may not.
 */
export default function CoverPanel({ trip, value, onChange }: CoverPanelProps) {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const live = useRef<string[]>([]);
  const { layout, pinned } = value;

  useEffect(() => {
    let cancelled = false;
    void getThumbs(trip.posts.map((post) => post.id)).then((blobs) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const [id, blob] of blobs) next.set(id, URL.createObjectURL(blob));
      live.current = [...next.values()];
      setUrls(next);
    });
    return () => {
      cancelled = true;
      for (const url of live.current) URL.revokeObjectURL(url);
      live.current = [];
    };
  }, [trip.posts]);

  /**
   * The pictures the previews draw, resolved to the WIDEST layout and never to
   * the selected one. Asking for `COVER_TILES[layout]` made the answer depend
   * on the question: with Cover picked, one tile came back and the Mosaic
   * preview beside it lost its two side pictures — so the layout you were
   * being asked to compare drew as an emptier thing than it is. Every preview
   * reads the same three tiles and takes what it needs; the first one is the
   * same either way (pins lead, then the busiest days), so Cover still shows
   * exactly the picture it would use.
   */
  const preview = useMemo(() => {
    const doc = { ...trip, cover: value };
    return coverTiles(doc, tripCoverage(doc), (id) => urls.has(id), COVER_TILES.mosaic);
  }, [trip, value, urls]);

  /** Every piece that has a picture, in the order the trip was lived. */
  const choices = useMemo(
    () =>
      trip.posts
        .filter((post) => urls.has(post.id))
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [trip.posts, urls],
  );

  const dropped = useMemo(() => droppedPins({ ...trip, cover: value }), [trip, value]);

  // The card exactly as the gallery will draw it, through the gallery's own
  // component, on the layout picked now — and what each of its pictures is.
  const card = useMemo(() => {
    const doc = { ...trip, cover: value };
    const coverage = tripCoverage(doc);
    return { doc, coverage, tiles: coverTiles(doc, coverage, (id) => urls.has(id)) };
  }, [trip, value, urls]);
  const asks = COVER_TILES[layout];
  const byId = useMemo(() => new Map(trip.posts.map((p) => [p.id, p])), [trip.posts]);

  return (
    <div className="@container">
      <div className="grid gap-6 items-start @[52rem]:grid-cols-[minmax(0,1fr)_19rem] @[52rem]:gap-8">
        {/* The card first on a phone, beside the choices on a wide pane — and
            pinned there while the pieces scroll. */}
        <aside className="flex flex-col gap-3 @[52rem]:order-last @[52rem]:sticky @[52rem]:top-0">
          <p className={legend}>In the gallery</p>
          <div className="max-w-[19rem] w-full rounded-paper-lg border border-line bg-surface shadow-paper-soft overflow-hidden">
            <CoverArt trip={card.doc} coverage={card.coverage} tiles={card.tiles} urls={urls} remoteOnly={false} />
            <div className="flex flex-col gap-1 p-4">
              <span className="text-base font-semibold truncate">{trip.name}</span>
              <span className="font-mono text-2xs text-muted truncate">
                {formatIsoDate(trip.startDate)} → {formatIsoDate(trip.endDate)}
              </span>
            </div>
          </div>
          {asks > 0 && card.tiles.length > 0 && (
            <ol className="m-0 p-0 list-none flex flex-col gap-1.5 max-w-[19rem]">
              {card.tiles.map((tile, i) => {
                const post = byId.get(tile.postId);
                return (
                  <li key={tile.postId} className="flex items-center gap-2.5 text-xs">
                    <span className="flex-none w-4 font-mono text-2xs text-faint text-right">{i + 1}</span>
                    <img src={urls.get(tile.postId)} alt="" className="flex-none w-8 h-8 rounded-[6px] object-cover border border-line" />
                    <span className="flex-1 min-w-0 truncate text-ink-soft">
                      {tile.dayNumber === null ? formatIsoDate(tile.date) : `Day ${tile.dayNumber}`}
                      {post?.title.trim() ? ` · ${post.title.trim()}` : ''}
                    </span>
                    <span
                      className={`flex-none font-mono text-3xs tracking-[0.08em] uppercase px-1.5 py-[2px] rounded-[6px] ${
                        tile.pinned ? 'bg-accent-wash text-accent-ink' : 'bg-paper-2 text-muted'
                      }`}
                    >
                      {tile.pinned ? 'pinned' : 'busiest day'}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>

        <div className="min-w-0 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className={legend}>Layout</p>
            <div className="grid grid-cols-2 @[30rem]:grid-cols-4 gap-2.5">
              {LAYOUTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onChange({ ...value, layout: option.id })}
                  title={option.note}
                  aria-pressed={layout === option.id}
                  className={`p-0 overflow-hidden rounded-paper border bg-paper cursor-pointer transition-colors text-left ${
                    layout === option.id ? 'border-accent ring-1 ring-accent' : 'border-line-strong hover:bg-paper-2'
                  }`}
                >
                  <LayoutPreview id={option.id} trip={trip} urls={preview.map((t) => urls.get(t.postId))} />
                  <span className="block px-2.5 py-2 border-t border-line">
                    <span className={`block font-sans text-xs font-semibold ${layout === option.id ? 'text-accent-ink' : 'text-ink-soft'}`}>
                      {option.label}
                    </span>
                    <span className="block text-2xs text-muted leading-snug">{option.note}</span>
                  </span>
                </button>
              ))}
            </div>
            {urls.size === 0 && (
              <p className="m-0 text-xs text-muted leading-relaxed">
                No piece of this trip has a picture on this device yet, so Mosaic and Cover have nothing to draw — the
                card falls back to the trip’s rhythm until one does. A piece bakes its picture the first time you open it
                in the editor.
              </p>
            )}
          </div>

          {asks > 0 && choices.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3">
                <p className={legend}>Pinned pieces</p>
                <span className="font-mono text-2xs text-muted tabular-nums">{pinned.length}/3</span>
                <span className="flex-1" />
                {pinned.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, pinned: [] })}
                    className="p-0 border-0 bg-transparent text-xs text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
                  >
                    Clear pins
                  </button>
                )}
              </div>
              <p className="m-0 text-xs text-ink-soft leading-relaxed">
                Click a piece to pin it, again to let it go. Up to three; what you leave unpinned fills from the trip’s
                busiest days.
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2.5 p-0.5">
                {choices.map((post) => {
                  const rank = pinned.indexOf(post.id);
                  const day = dayNumberOf(trip, post.date);
                  return (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => onChange({ ...value, pinned: togglePin(pinned, post.id) })}
                      aria-pressed={rank >= 0}
                      aria-label={`${rank >= 0 ? 'Unpin' : 'Pin'} ${day === null ? post.date : `day ${day}`}${post.title ? ` — ${post.title}` : ''}`}
                      title={day === null ? post.date : `Day ${day} — ${post.title || 'piece'}`}
                      className="group flex flex-col gap-1 p-0 border-0 bg-transparent text-left cursor-pointer"
                    >
                      <span
                        className={`relative block w-full aspect-[4/5] rounded-[10px] overflow-hidden border ${
                          rank >= 0 ? 'border-accent ring-2 ring-accent' : 'border-line group-hover:border-line-strong'
                        }`}
                      >
                        <img src={urls.get(post.id)} alt="" loading="lazy" className="block w-full h-full min-h-0 min-w-0 object-cover" />
                        {rank >= 0 && (
                          <b className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-accent text-paper font-mono text-2xs font-normal flex items-center justify-center">
                            {rank + 1}
                          </b>
                        )}
                      </span>
                      <span className="min-w-0 flex flex-col leading-tight">
                        <span className="font-mono text-2xs text-muted">{day === null ? formatIsoDate(post.date) : `Day ${day}`}</span>
                        <span className={`text-xs truncate ${rank >= 0 ? 'text-accent-ink font-semibold' : 'text-ink-soft'}`}>
                          {post.title.trim() || 'Untitled'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {dropped.length > 0 && (
            <p className="m-0 px-3 py-2.5 rounded-paper border border-danger-line bg-accent-wash text-xs text-ink-soft leading-relaxed">
              <b className="font-semibold text-accent-ink">
                {dropped.length === 1 ? 'One pin points' : `${dropped.length} pins point`} at nothing.
              </b>{' '}
              {dropped.length === 1 ? 'The piece it named is' : 'The pieces they named are'} gone, so the cover takes the next
              busiest day instead. Saving forgets {dropped.length === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The layout, drawn with the pictures it would really use. A preview that
 * showed an invented arrangement would be the fabricated example the tool
 * refuses everywhere else — with nothing to draw it falls back to bare SLOTS,
 * which is exactly what the card would do, and never to a flat fill.
 */
function LayoutPreview({
  id,
  trip,
  urls,
}: {
  id: CoverLayout;
  trip: TripDoc;
  urls: Array<string | undefined>;
}) {
  const tile = (url: string | undefined, className = '') =>
    url ? (
      <img
        src={url}
        alt=""
        className={`block w-full h-full min-h-0 min-w-0 object-cover ${className}`}
      />
    ) : (
      <span
        className={`flex items-center justify-center w-full h-full bg-paper-2 border border-line text-faint ${className}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="3.5"
            y="5.5"
            width="17"
            height="13"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle cx="9" cy="10" r="1.6" fill="currentColor" />
          <path
            d="M4.5 16.5 9 12.5l3.5 3 3-2.5 4 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );

  if (id === 'mosaic') {
    return (
      <span className="grid grid-cols-[1.7fr_1fr] grid-rows-2 gap-[2px] h-[76px] overflow-hidden">
        <span className="row-span-2">{tile(urls[0])}</span>
        {tile(urls[1])}
        {tile(urls[2])}
      </span>
    );
  }
  if (id === 'cover') {
    return <span className="block h-[76px] overflow-hidden">{tile(urls[0])}</span>;
  }
  if (id === 'rhythm') {
    // The trip's real weeks, folded onto ten bars — a made-up pattern here
    // would be the fabricated example the tool refuses everywhere else.
    const bars = rhythmBuckets(tripCoverage(trip), 10);
    return (
      <span className="flex items-end gap-[2px] h-[76px] px-2 py-2 bg-surface">
        {bars.map((bar) => {
          const level = rhythmLevel(bar);
          return (
            <i
              key={bar.from}
              className="flex-1 rounded-[2px]"
              style={{ height: `${6 + (level / 4) * 52}px`, background: HEATMAP_LEVELS[level] }}
            />
          );
        })}
      </span>
    );
  }
  return (
    <span className="flex flex-col justify-center gap-1.5 h-[76px] px-3 bg-surface">
      <i className="h-[6px] w-[56%] rounded-[3px] bg-line-strong" />
      <i className="h-[4px] w-[78%] rounded-[3px] bg-line" />
      <i className="h-[4px] w-[40%] rounded-[3px] bg-line" />
    </span>
  );
}
