import { useEffect, useMemo, useState } from 'react';
import { formatIsoDate, spanLength, type IsoDate } from '../../shared/roadtrip/trip-days';
import {
  stageAt,
  stageDayNumber,
  type DayCell,
} from '../../shared/roadtrip/trip-coverage';
import { getThumbs } from '../../shared/roadtrip/trip-store';
import {
  POST_KINDS,
  duplicateTripPost,
  type PostKind,
  type TripDoc,
  type TripPost,
} from '../../shared/roadtrip/trip-types';

interface DayPanelProps {
  trip: TripDoc;
  date: IsoDate;
  cell: DayCell | null;
  /** Make a piece of this kind from this day, and open it. */
  onStartPost: (kind: PostKind) => void;
  onAddPost: (post: TripPost) => void;
  onUpdatePost: (post: TripPost) => void;
  onDeletePost: (id: string) => void;
  onOpenPost: (post: TripPost) => void;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

/** A row's secondary actions: small round glyph buttons, named by their title. */
const iconButton =
  'flex-none w-7 h-7 grid place-items-center rounded-full border border-line bg-paper text-[0.85rem] leading-none text-ink-soft cursor-pointer transition-colors hover:border-accent hover:text-accent-ink';

function formatPublished(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Stop a control inside the row from also opening the piece. Every button in
 * the row needs it: without it, marking something published or starting a
 * delete would open the editor at the same time, and the action would be lost
 * behind a screen change.
 */
function stopRow(e: React.MouseEvent) {
  e.stopPropagation();
  e.preventDefault();
}

function PostRow({
  post,
  thumb,
  onUpdate,
  onDuplicate,
  onDelete,
  onOpen,
}: {
  post: TripPost;
  thumb: string | null;
  onUpdate: (post: TripPost) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const kind = POST_KINDS.find((k) => k.id === post.kind);

  return (
    // The whole row opens the piece — the thumbnail and the Hook button are
    // small targets in a list you sweep through. It is a `div` with a button
    // role rather than a `<button>`, because a row holds buttons of its own
    // and nesting them is invalid.
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onOpen();
      }}
      aria-label={`Open ${post.title || 'this piece'}`}
      className="flex items-center gap-3 py-2 border-b border-line last:border-b-0 cursor-pointer rounded-paper transition-colors hover:bg-paper-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
      {/* The hook as it was last composed, at the frame it was composed for:
          a 16:9 piece is wide here and a 9:16 one is narrow. Fixing the box
          and cropping to it would hide the one thing the picture is for —
          recognising, at a glance, what shape the piece is. Only the height
          is fixed, so the rows still line up. A post never opened has no
          picture, and gets a placeholder of the commonest frame rather than
          collapsing its row. */}
      <span
        aria-hidden="true"
        className="flex-none h-[48px] rounded-[4px] overflow-hidden border border-line bg-paper-2 leading-none"
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="h-full w-auto max-w-[96px] object-contain block"
            draggable={false}
          />
        ) : (
          <span className="block h-full w-[38px]" aria-hidden="true" />
        )}
      </span>
      <span
        className={`flex-none font-mono text-[0.6rem] tracking-[0.1em] uppercase px-2 py-[3px] rounded-full border ${
          post.publishedAt === null
            ? 'border-line text-muted'
            : 'border-accent bg-accent-wash text-accent-ink'
        }`}
      >
        {kind?.label ?? post.kind}
      </span>

      <span className="flex-1 min-w-0">
        <span className="block text-[0.85rem] truncate" title={post.title}>
          {post.title || <span className="text-faint italic">Untitled</span>}
        </span>
        <span className="block font-mono text-[0.66rem] text-faint">
          {post.publishedAt === null
            ? 'draft'
            : `published ${formatPublished(post.publishedAt)}`}
          {post.media && <> · {post.media.name}</>}
        </span>
      </span>

      {/* The secondary actions are icons — three words of button chrome per
          row drowned the titles the list exists to scan. Each one keeps its
          full name in the title/aria-label, and Delete keeps its two-step
          confirm; only the trigger shrank. */}
      <button
        type="button"
        onClick={(e) => {
          stopRow(e);
          onDuplicate();
        }}
        className={iconButton}
        title="Duplicate — a copy of this piece on the same day"
        aria-label="Duplicate this piece"
      >
        ⧉
      </button>

      <button
        type="button"
        onClick={(e) => {
          stopRow(e);
          onUpdate({
            ...post,
            publishedAt: post.publishedAt === null ? Date.now() : null,
          });
        }}
        className={`${iconButton} ${
          post.publishedAt !== null
            ? 'border-accent bg-accent-wash text-accent-ink'
            : ''
        }`}
        title={post.publishedAt === null ? 'Mark published' : 'Back to draft'}
        aria-label={post.publishedAt === null ? 'Mark published' : 'Back to draft'}
        aria-pressed={post.publishedAt !== null}
      >
        ✓
      </button>

      {confirming ? (
        <span className="flex-none flex items-center gap-2 text-[0.75rem]">
          <button
            type="button"
            onClick={(e) => {
              stopRow(e);
              onDelete();
            }}
            className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={(e) => {
              stopRow(e);
              setConfirming(false);
            }}
            className="p-0 border-0 bg-transparent text-muted cursor-pointer"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            stopRow(e);
            setConfirming(true);
          }}
          className={`${iconButton} hover:text-[#9a3a23] hover:border-[#e3b8a9]`}
          title="Delete this piece"
          aria-label="Delete this piece"
        >
          ×
        </button>
      )}

      {/* Opening stays the whole row's gesture; the pill makes it visible.
          It stops propagation like every other control — onOpen firing twice
          through the bubble would be sloppy even where it is harmless. */}
      <button
        type="button"
        onClick={(e) => {
          stopRow(e);
          onOpen();
        }}
        className="flex-none px-3.5 py-1.5 border border-ink rounded-full bg-ink text-paper text-[0.75rem] font-semibold cursor-pointer hover:bg-accent hover:border-accent"
      >
        Open
      </button>
    </li>
  );
}

/**
 * One day of the trip, opened from the grid: what has already been told from
 * it, and the one gesture that matters here — starting another piece.
 *
 * Starting one is ONE click. It used to be three (pick a kind, type a name,
 * press Add) and the two extra ones asked for what the editor asks better: a
 * kind is what the button says, and a piece is named once you can see what it
 * shows. So each kind is its own button, it creates the piece with the look
 * the trip last gave that kind, and it opens it — a piece left in a list is a
 * stub, and composing it is why it was made.
 */
export default function DayPanel({
  trip,
  date,
  cell,
  onStartPost,
  onAddPost,
  onUpdatePost,
  onDeletePost,
  onOpenPost,
}: DayPanelProps) {
  const posts = cell?.posts ?? [];
  const ids = useMemo(() => posts.map((p) => p.id).join('|'), [posts]);

  /**
   * The stored hooks, as object URLs. Keyed on the ids so switching day
   * reloads, and every URL is revoked on the way out — an unrevoked blob URL
   * holds its bytes for the lifetime of the document.
   */
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void getThumbs(ids ? ids.split('|') : []).then((blobs) => {
      const next = new Map<string, string>();
      for (const [id, blob] of blobs) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next.set(id, url);
      }
      if (alive) setThumbs(next);
      else for (const url of urls) URL.revokeObjectURL(url);
    });
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [ids]);

  const stage = stageAt(trip, date);
  const atStage = stage ? stageDayNumber(stage, date) : null;
  const totalDays = spanLength(trip.startDate, trip.endDate);

  return (
    <section
      className="flex flex-col gap-4 bg-surface border border-line rounded-paper-lg p-5"
      aria-label={`Day ${cell?.dayNumber ?? ''}`}
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="m-0 font-serif text-[1.3rem]">
          Day {cell?.dayNumber ?? '—'}
          {totalDays !== null && <span className="text-faint"> / {totalDays}</span>}
        </h2>
        <span className="font-mono text-[0.72rem] text-muted">
          {formatIsoDate(date)}
        </span>
        {stage && (
          <span className="font-mono text-[0.68rem] text-accent-ink">
            {stage.name}
            {atStage ? ` · day ${atStage.day}/${atStage.total}` : ''}
          </span>
        )}
      </div>

      {posts.length === 0 ? (
        <p className="m-0 text-[0.84rem] text-muted">
          Nothing told from this day yet.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              thumb={thumbs.get(post.id) ?? null}
              onUpdate={onUpdatePost}
              onDuplicate={() => onAddPost(duplicateTripPost(post))}
              onDelete={() => onDeletePost(post.id)}
              onOpen={() => onOpenPost(post)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 pt-1 border-t border-line">
        <span className={`${legend} pt-3`}>Tell this day</span>
        <div className="flex flex-wrap items-center gap-2">
          {POST_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => onStartPost(k.id)}
              title={`${k.hint} — opens straight away`}
              className="px-3.5 py-2 rounded-full border border-ink bg-ink text-paper text-[0.8rem] font-semibold cursor-pointer transition-colors hover:bg-accent hover:border-accent"
            >
              {k.label}
            </button>
          ))}
          <span className="text-[0.74rem] text-muted">
            It opens straight away — name it and dress it there.
          </span>
        </div>
      </div>
    </section>
  );
}
