import { useEffect, useMemo, useRef, useState } from 'react';
import useDialogKeys from '../../shared/ui/use-dialog-keys';
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

interface TripCoverModalProps {
  trip: TripDoc;
  onCancel: () => void;
  onSave: (cover: TripCover) => void;
}

const LAYOUTS: Array<{ id: CoverLayout; label: string; needs: string; note: string }> = [
  { id: 'mosaic', label: 'Mosaic', needs: '3 pictures', note: 'Three pieces, so the trip reads as a place.' },
  { id: 'cover', label: 'Cover', needs: '1 picture', note: 'One picture, filling the card.' },
  { id: 'rhythm', label: 'Rhythm', needs: 'your days', note: 'No picture: the trip’s own weeks.' },
  { id: 'none', label: 'None', needs: 'no cover', note: 'The compact card, for a screen full of trips.' },
];

const legend = 'm-0 font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

/**
 * Choosing what a trip shows of itself.
 *
 * Opened from the GALLERY, not from `TripSettingsModal` — that sheet is reached
 * from a piece, so a trip with no piece could never be settled from it (the
 * same reason the rename and the dates live on the overview's heading). A cover
 * is looked at in the gallery, so it is chosen there.
 *
 * Every thumbnail of the trip is loaded here rather than the handful the card
 * needs: the point of the screen is to see the pieces and pick among them. They
 * are revoked on close — a modal opened deliberately may hold a few megabytes;
 * a gallery may not.
 */
export default function TripCoverModal({ trip, onCancel, onSave }: TripCoverModalProps) {
  const [layout, setLayout] = useState<CoverLayout>(trip.cover.layout);
  const [pinned, setPinned] = useState<string[]>(trip.cover.pinned);
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const live = useRef<string[]>([]);

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

  const draft = useMemo<TripCover>(() => ({ layout, pinned }), [layout, pinned]);
  const preview = useMemo(() => {
    const doc = { ...trip, cover: draft };
    return coverTiles(doc, tripCoverage(doc), (id) => urls.has(id), COVER_TILES[layout] || 3);
  }, [trip, draft, urls, layout]);

  /** Every piece that has a picture, in the order the trip was lived. */
  const choices = useMemo(
    () =>
      trip.posts
        .filter((post) => urls.has(post.id))
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [trip.posts, urls],
  );

  const dropped = useMemo(() => droppedPins({ ...trip, cover: draft }), [trip, draft]);

  useDialogKeys({ onCancel, onConfirm: () => onSave(draft) });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(20,18,15,0.45)] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Cover for ${trip.name}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[34rem] max-h-[90dvh] flex flex-col gap-5 bg-surface border border-line rounded-paper-lg shadow-paper p-6 overflow-auto">
        <div>
          <h2 className="m-0 font-serif text-[1.4rem]">Cover</h2>
          <p className="m-0 mt-1 text-[0.82rem] text-muted">
            How {trip.name || 'this trip'} shows itself in the gallery.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className={legend}>Layout</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2.5">
            {LAYOUTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLayout(option.id)}
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
              No piece of this trip has a picture on this device yet, so Mosaic
              and Cover have nothing to draw — the card falls back to the trip’s
              rhythm until one does. A piece bakes its picture the first time you
              open it in the editor.
            </p>
          )}
        </div>

        {COVER_TILES[layout] > 0 && choices.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className={legend}>Pinned pieces</p>
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
                      onClick={() => setPinned((cur) => togglePin(cur, post.id))}
                      aria-pressed={rank >= 0}
                      title={day === null ? post.date : `Day ${day} — ${post.title || 'piece'}`}
                      className={`relative w-[62px] h-[82px] rounded-[10px] overflow-hidden border cursor-pointer p-0 ${
                        rank >= 0 ? 'border-[1.5px] border-accent' : 'border-line hover:border-line-strong'
                      }`}
                    >
                      <img
                        src={urls.get(post.id)}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
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
            {dropped.length === 1 ? 'The piece it named is' : 'The pieces they named are'} gone, so
            the cover takes the next busiest day instead. Saving forgets{' '}
            {dropped.length === 1 ? 'it' : 'them'}.
          </p>
        )}

        <div className="flex items-center justify-end gap-4 pt-4 border-t border-line">
          {pinned.length > 0 && (
            <button
              type="button"
              onClick={() => setPinned([])}
              className="mr-auto p-0 border-0 bg-transparent text-[0.8rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
            >
              Clear pins
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="p-0 border-0 bg-transparent text-[0.84rem] text-muted cursor-pointer hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ layout, pinned: pinned.filter((id) => !dropped.includes(id)) })}
            className="px-[1.1rem] py-2 inline-flex items-center border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.84rem] font-semibold transition-colors duration-200 ease-paper hover:bg-accent hover:border-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The layout, drawn with the pictures it would really use. A preview that
 * showed an invented arrangement would be the fabricated example the tool
 * refuses everywhere else — with nothing to draw it falls back to bare tiles,
 * which is exactly what the card would do.
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
      <img src={url} alt="" className={`block w-full h-full min-h-0 min-w-0 object-cover ${className}`} />
    ) : (
      // An empty slot must read as a picture SLOT, not as a blank card: a flat
      // fill made the whole picker look broken on a trip with no thumbnails
      // yet, which is every trip before its first piece is composed.
      <span
        className={`flex items-center justify-center w-full h-full bg-paper-2 border border-line text-faint ${className}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="9" cy="10" r="1.6" fill="currentColor" />
          <path d="M4.5 16.5 9 12.5l3.5 3 3-2.5 4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
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
  if (id === 'cover') return <span className="block h-[60px] overflow-hidden">{tile(urls[0])}</span>;
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
              style={{ height: `${4 + (level / 4) * 40}px`, background: HEATMAP_LEVELS[level] }}
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
