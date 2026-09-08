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

interface CoverPanelProps {
  trip: TripDoc;
  value: TripCover;
  onChange: (cover: TripCover) => void;
}

const LAYOUTS: Array<{ id: CoverLayout; label: string; needs: string; note: string }> = [
  {
    id: 'mosaic',
    label: 'Mosaic',
    needs: '3 pictures',
    note: 'Three pieces, so the trip reads as a place.',
  },
  { id: 'cover', label: 'Cover', needs: '1 picture', note: 'One picture, filling the card.' },
  { id: 'rhythm', label: 'Rhythm', needs: 'your days', note: 'No picture: the trip’s own weeks.' },
  {
    id: 'none',
    label: 'None',
    needs: 'no cover',
    note: 'The compact card, for a screen full of trips.',
  },
];

const legend = 'm-0 font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

/**
 * Choosing what a trip shows of itself: the layout, and the pieces pinned to it.
 *
 * A controlled panel rather than a screen, because it has TWO homes and neither
 * can be the only one. The trip's details sheet is where the trip's own
 * properties are edited, so the cover belongs beside its name and its dates;
 * the gallery is where a cover is looked at, so it is also reachable from the
 * card. One panel, so the two can never drift — the same reason `StylePanel`
 * and `GradePanel` became shared the moment they had a second consumer.
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

  const preview = useMemo(() => {
    const doc = { ...trip, cover: value };
    return coverTiles(doc, tripCoverage(doc), (id) => urls.has(id), COVER_TILES[layout] || 3);
  }, [trip, value, urls, layout]);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className={legend}>Layout</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2.5">
          {LAYOUTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange({ ...value, layout: option.id })}
              title={option.note}
              aria-pressed={layout === option.id}
              className={`p-0 overflow-hidden rounded-paper border bg-paper cursor-pointer transition-colors ${
                layout === option.id
                  ? 'border-accent'
                  : 'border-line-strong hover:border-line-strong hover:bg-paper-2'
              }`}
            >
              <LayoutPreview
                id={option.id}
                trip={trip}
                urls={preview.map((t) => urls.get(t.postId))}
              />
              <span className="block px-2 py-1.5 border-t border-line">
                <span
                  className={`block font-sans text-[0.78rem] font-semibold ${
                    layout === option.id ? 'text-accent-ink' : 'text-ink-soft'
                  }`}
                >
                  {option.label}
                </span>
                <span className="block font-mono text-[0.56rem] tracking-[0.06em] uppercase text-faint">
                  {option.needs}
                </span>
              </span>
            </button>
          ))}
        </div>
        {urls.size === 0 && (
          <p className="m-0 text-[0.76rem] text-muted leading-relaxed">
            No piece of this trip has a picture on this device yet, so Mosaic and
            Cover have nothing to draw — the card falls back to the trip’s rhythm
            until one does. A piece bakes its picture the first time you open it
            in the editor.
          </p>
        )}
      </div>

      {COVER_TILES[layout] > 0 && choices.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-3">
            <p className={legend}>Pinned pieces</p>
            <span className="flex-1" />
            {pinned.length > 0 && (
              <button
                type="button"
                onClick={() => onChange({ ...value, pinned: [] })}
                className="p-0 border-0 bg-transparent text-[0.74rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
              >
                Clear pins
              </button>
            )}
          </div>
          <p className="m-0 text-[0.78rem] text-ink-soft leading-relaxed">
            Pin up to three. Whatever you leave unpinned fills from the trip’s
            busiest days — clear them all and the cover follows the trip on its
            own.
          </p>
          <div className="flex flex-wrap gap-2 max-h-[13rem] overflow-auto p-0.5">
            {choices.map((post) => {
              const rank = pinned.indexOf(post.id);
              const day = dayNumberOf(trip, post.date);
              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => onChange({ ...value, pinned: togglePin(pinned, post.id) })}
                  aria-pressed={rank >= 0}
                  title={day === null ? post.date : `Day ${day} — ${post.title || 'piece'}`}
                  className={`relative w-[62px] h-[82px] rounded-[10px] overflow-hidden border cursor-pointer p-0 ${
                    rank >= 0
                      ? 'border-[1.5px] border-accent'
                      : 'border-line hover:border-line-strong'
                  }`}
                >
                  <img
                    src={urls.get(post.id)}
                    alt=""
                    loading="lazy"
                    className="block w-full h-full min-h-0 min-w-0 object-cover"
                  />
                  {rank >= 0 && (
                    <b className="absolute top-1 left-1 w-4 h-4 rounded-full bg-accent text-paper font-mono text-[0.55rem] font-normal flex items-center justify-center">
                      {rank + 1}
                    </b>
                  )}
                  {day !== null && (
                    <span className="absolute inset-x-0 bottom-0 py-[1px] font-mono text-[0.52rem] text-paper bg-[rgba(16,15,13,0.45)]">
                      {day}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {dropped.length > 0 && (
        <p className="m-0 px-3 py-2.5 rounded-paper border border-[#f0d5cb] bg-accent-wash text-[0.78rem] text-ink-soft leading-relaxed">
          <b className="font-semibold text-accent-ink">
            {dropped.length === 1 ? 'One pin points' : `${dropped.length} pins point`} at nothing.
          </b>{' '}
          {dropped.length === 1 ? 'The piece it named is' : 'The pieces they named are'} gone, so the
          cover takes the next busiest day instead. Saving forgets{' '}
          {dropped.length === 1 ? 'it' : 'them'}.
        </p>
      )}
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
      <span className="grid grid-cols-[1.7fr_1fr] grid-rows-2 gap-[2px] h-[60px] overflow-hidden">
        <span className="row-span-2">{tile(urls[0])}</span>
        {tile(urls[1])}
        {tile(urls[2])}
      </span>
    );
  }
  if (id === 'cover') {
    return <span className="block h-[60px] overflow-hidden">{tile(urls[0])}</span>;
  }
  if (id === 'rhythm') {
    // The trip's real weeks, folded onto ten bars — a made-up pattern here
    // would be the fabricated example the tool refuses everywhere else.
    const bars = rhythmBuckets(tripCoverage(trip), 10);
    return (
      <span className="flex items-end gap-[2px] h-[60px] px-2 py-2 bg-surface">
        {bars.map((bar) => {
          const level = rhythmLevel(bar);
          return (
            <i
              key={bar.from}
              className="flex-1 rounded-[2px]"
              style={{ height: `${6 + (level / 4) * 38}px`, background: HEATMAP_LEVELS[level] }}
            />
          );
        })}
      </span>
    );
  }
  return (
    <span className="flex flex-col justify-center gap-1.5 h-[60px] px-3 bg-surface">
      <i className="h-[6px] w-[56%] rounded-[3px] bg-line-strong" />
      <i className="h-[4px] w-[78%] rounded-[3px] bg-line" />
      <i className="h-[4px] w-[40%] rounded-[3px] bg-line" />
    </span>
  );
}
