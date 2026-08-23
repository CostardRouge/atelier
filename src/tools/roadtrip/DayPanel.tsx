import { useState } from 'react';
import { formatIsoDate, spanLength, type IsoDate } from '../../shared/roadtrip/trip-days';
import {
  stageAt,
  stageDayNumber,
  type DayCell,
} from '../../shared/roadtrip/trip-coverage';
import {
  POST_KINDS,
  createTripPost,
  type PostKind,
  type TripDoc,
  type TripPost,
} from '../../shared/roadtrip/trip-types';

interface DayPanelProps {
  trip: TripDoc;
  date: IsoDate;
  cell: DayCell | null;
  onAddPost: (post: TripPost) => void;
  onUpdatePost: (post: TripPost) => void;
  onDeletePost: (id: string) => void;
  onOpenPost: (post: TripPost) => void;
}

const legend = 'font-mono text-[0.64rem] tracking-[0.14em] uppercase text-muted';

function formatPublished(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function PostRow({
  post,
  onUpdate,
  onDelete,
  onOpen,
}: {
  post: TripPost;
  onUpdate: (post: TripPost) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const kind = POST_KINDS.find((k) => k.id === post.kind);

  return (
    <li className="flex items-center gap-3 py-2 border-b border-line last:border-b-0">
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

      <button
        type="button"
        onClick={onOpen}
        className="flex-none px-3 py-1.5 border border-line-strong rounded-full bg-paper text-[0.75rem] font-semibold text-ink-soft cursor-pointer hover:border-accent hover:text-accent-ink"
      >
        Hook
      </button>

      <button
        type="button"
        onClick={() =>
          onUpdate({
            ...post,
            publishedAt: post.publishedAt === null ? Date.now() : null,
          })
        }
        className="flex-none p-0 border-0 bg-transparent text-[0.75rem] text-muted cursor-pointer underline underline-offset-[3px] hover:text-accent-ink"
      >
        {post.publishedAt === null ? 'Mark published' : 'Back to draft'}
      </button>

      {confirming ? (
        <span className="flex-none flex items-center gap-2 text-[0.75rem]">
          <button
            type="button"
            onClick={onDelete}
            className="p-0 border-0 bg-transparent text-[#9a3a23] font-semibold cursor-pointer underline underline-offset-[3px]"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="p-0 border-0 bg-transparent text-muted cursor-pointer"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex-none p-0 border-0 bg-transparent text-[0.75rem] text-faint cursor-pointer hover:text-[#9a3a23]"
          aria-label="Delete this post"
        >
          Delete
        </button>
      )}
    </li>
  );
}

/**
 * One day of the trip, opened from the grid: what has already been told from
 * it, and the one gesture that matters here — adding another piece. Composing
 * a piece's hook is a screen of its own (`PostEditor`), reached from its row;
 * this panel stays a list. Slides and the closing call to action come later.
 */
export default function DayPanel({
  trip,
  date,
  cell,
  onAddPost,
  onUpdatePost,
  onDeletePost,
  onOpenPost,
}: DayPanelProps) {
  const [kind, setKind] = useState<PostKind>('reel');
  const [title, setTitle] = useState('');

  const stage = stageAt(trip, date);
  const atStage = stage ? stageDayNumber(stage, date) : null;
  const posts = cell?.posts ?? [];
  const totalDays = spanLength(trip.startDate, trip.endDate);

  function add() {
    onAddPost(createTripPost(kind, date, title));
    setTitle('');
  }

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
              onUpdate={onUpdatePost}
              onDelete={() => onDeletePost(post.id)}
              onOpen={() => onOpenPost(post)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 pt-1 border-t border-line">
        <span className={`${legend} pt-3`}>Add a piece from this day</span>
        <div className="flex flex-wrap items-center gap-2">
          {POST_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              title={k.hint}
              aria-pressed={kind === k.id}
              className={`px-3 py-1.5 rounded-full border text-[0.78rem] cursor-pointer transition-colors ${
                kind === k.id
                  ? 'border-accent bg-accent-wash text-accent-ink font-semibold'
                  : 'border-line bg-paper text-ink-soft hover:border-line-strong'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            placeholder="What it shows — for finding it again"
            className="flex-1 min-w-0 font-sans text-[0.88rem] px-3 py-2 border border-line-strong rounded-paper bg-paper text-ink focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={add}
            className="flex-none px-4 py-2 border border-ink rounded-full bg-ink text-paper cursor-pointer text-[0.8rem] font-semibold hover:bg-accent hover:border-accent"
          >
            Add
          </button>
        </div>
      </div>
    </section>
  );
}
