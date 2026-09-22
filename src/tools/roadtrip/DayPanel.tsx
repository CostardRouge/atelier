import { useState, type MouseEvent } from 'react';
import { formatIsoDate, spanLength, type IsoDate } from '../../shared/roadtrip/trip-days';
import {
  stageAt,
  stageDayNumber,
  type DayCell,
} from '../../shared/roadtrip/trip-coverage';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import {
  POST_KINDS,
  duplicateTripPost,
  type PostKind,
  type TripDoc,
  type TripPost,
} from '../../shared/roadtrip/trip-types';
import { DayMenu, type Menu } from './DayHeatmap';
import useDayThumbs from './use-day-thumbs';

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
  /**
   * `card` is the bordered block under a wide screen's calendar, with the day
   * as its heading. `sheet` is the body of the phone's day sheet: no frame
   * (the sheet is one), no heading (the sheet's title is the day), the leg as
   * a row that opens it, and each piece's secondary actions folded behind a
   * `⋯` — four controls per row do not fit a 374px sheet.
   */
  variant?: 'card' | 'sheet';
  /** Open the leg the day belongs to (the sheet's leg row). */
  onEditLeg?: (stageId: string) => void;
  /** The pieces' hooks, when the host already read them (the strip shares them); read here otherwise. */
  thumbs?: ReadonlyMap<string, string>;
}

const legend = 'font-mono text-2xs tracking-[0.14em] uppercase text-muted';

/** A row's secondary actions: small round glyph buttons, named by their title. */
const iconButton =
  'flex-none w-7 h-7 grid place-items-center rounded-full border border-line bg-paper text-sm leading-none text-ink-soft cursor-pointer transition-colors hover:border-accent hover:text-accent-ink';

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
function stopRow(e: MouseEvent) {
  e.stopPropagation();
  e.preventDefault();
}

function PostRow({
  post,
  cell,
  thumb,
  compact,
  onUpdate,
  onDuplicate,
  onDelete,
  onOpen,
}: {
  post: TripPost;
  cell: DayCell | null;
  thumb: string | null;
  compact: boolean;
  onUpdate: (post: TripPost) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const kind = POST_KINDS.find((k) => k.id === post.kind);
  const published = post.publishedAt !== null;
  const togglePublished = () =>
    onUpdate({ ...post, publishedAt: post.publishedAt === null ? Date.now() : null });

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
      className="flex items-center gap-3 py-2 px-2 -mx-2 cursor-pointer rounded-paper transition-colors hover:bg-paper-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink">
      {/* The hook as it was last composed, at the frame it was composed for:
          a 16:9 piece is wide here and a 9:16 one is narrow. Fixing the box
          and cropping to it would hide the one thing the picture is for —
          recognising, at a glance, what shape the piece is. Only the height
          is fixed, so the rows still line up. A post never opened has no
          picture, and gets a placeholder of the commonest frame rather than
          collapsing its row. */}
      <span
        aria-hidden="true"
        className={`flex-none h-[48px] rounded-[4px] overflow-hidden border bg-paper-2 leading-none ${
          compact && !published ? 'border-dashed border-line-strong' : 'border-line'
        }`}
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
        className={`flex-none font-mono text-3xs tracking-[0.1em] uppercase px-2 py-[3px] rounded-full border ${
          post.publishedAt === null
            ? 'border-line text-muted'
            : 'border-accent bg-accent-wash text-accent-ink'
        }`}
      >
        {kind?.label ?? post.kind}
      </span>

      <span className="flex-1 min-w-0">
        <span className="block text-sm truncate" title={post.title}>
          {post.title || <span className="text-faint italic">Untitled</span>}
        </span>
        <span className="block font-mono text-2xs text-faint truncate">
          {post.publishedAt === null
            ? 'draft'
            : `published ${formatPublished(post.publishedAt)}`}
          {post.media && <> · {post.media.name}</>}
        </span>
      </span>

      {confirming ? (
        <span className="flex-none flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={(e) => {
              stopRow(e);
              onDelete();
            }}
            className="p-0 border-0 bg-transparent text-danger font-semibold cursor-pointer underline underline-offset-[3px]"
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
      ) : compact ? (
        /* On a phone the secondary actions live behind one glyph: the same
           menu the calendar's cells open, so a phone learns one menu. Delete
           still asks twice — the menu only starts the confirm. */
        <button
          type="button"
          onClick={(e) => {
            stopRow(e);
            if (!cell) return;
            setMenu({
              cell,
              x: e.clientX,
              y: e.clientY,
              items: [
                { label: 'Open', run: onOpen },
                { label: published ? 'Back to draft' : 'Mark published', run: togglePublished },
                { label: 'Duplicate on this day', run: onDuplicate },
                { label: 'Delete…', run: () => setConfirming(true) },
              ],
            });
          }}
          className={iconButton}
          title="More"
          aria-label={`More actions for ${post.title || 'this piece'}`}
          aria-haspopup="menu"
        >
          ⋯
        </button>
      ) : (
        <>
          {/* The secondary actions are icons — three words of button chrome
              per row drowned the titles the list exists to scan. Each one
              keeps its full name in the title/aria-label, and Delete keeps
              its two-step confirm; only the trigger shrank. */}
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
              togglePublished();
            }}
            className={`${iconButton} ${published ? 'border-accent bg-accent-wash text-accent-ink' : ''}`}
            title={published ? 'Back to draft' : 'Mark published'}
            aria-label={published ? 'Back to draft' : 'Mark published'}
            aria-pressed={published}
          >
            ✓
          </button>

          <button
            type="button"
            onClick={(e) => {
              stopRow(e);
              setConfirming(true);
            }}
            className={`${iconButton} hover:text-danger hover:border-danger-line`}
            title="Delete this piece"
            aria-label="Delete this piece"
          >
            ×
          </button>

          {/* Opening stays the whole row's gesture; the pill makes it visible.
              It stops propagation like every other control — onOpen firing
              twice through the bubble would be sloppy even where it is
              harmless. */}
          <button
            type="button"
            onClick={(e) => {
              stopRow(e);
              onOpen();
            }}
            className="flex-none px-3.5 py-1.5 border border-ink rounded-full bg-ink text-paper text-xs font-semibold cursor-pointer hover:bg-accent hover:border-accent"
          >
            Open
          </button>
        </>
      )}

      {/* The menu is a descendant of the row, so its clicks would bubble to
          the row's own `onOpen` — every item opened the piece as well. */}
      {menu && (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <DayMenu menu={menu} onClose={() => setMenu(null)} />
        </span>
      )}
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
  variant = 'card',
  onEditLeg,
  thumbs: given,
}: DayPanelProps) {
  const posts = cell?.posts ?? [];
  const own = useDayThumbs(given ? [] : posts);
  const thumbs = given ?? own;
  const sheet = variant === 'sheet';

  const stage = stageAt(trip, date);
  const atStage = stage ? stageDayNumber(stage, date) : null;
  const totalDays = spanLength(trip.startDate, trip.endDate);
  const published = posts.filter((p) => p.publishedAt !== null).length;
  const drafts = posts.length - published;

  return (
    <section
      className={
        sheet
          ? 'flex flex-col gap-3'
          : 'flex flex-col gap-4 bg-surface border border-line rounded-paper-lg p-5'
      }
      aria-label={`Day ${cell?.dayNumber ?? ''}`}
    >
      {sheet ? (
        /* The leg as a row that opens it: the day is where the question
           "which leg was I on" is actually asked. */
        stage && (
          <button
            type="button"
            onClick={() => onEditLeg?.(stage.id)}
            disabled={!onEditLeg}
            className="flex items-center gap-2.5 w-full -mx-1 px-1 py-2 border-0 border-y border-line bg-transparent text-left cursor-pointer disabled:cursor-default"
          >
            <span
              className="flex-none w-[9px] h-[9px] rounded-full"
              style={{ background: stageTint(trip.stages.indexOf(stage)) }}
              aria-hidden="true"
            />
            <span className="flex-1 min-w-0 text-sm truncate">
              {stageLabel(stage) || 'Unnamed stage'}
              <span className="text-muted">
                {atStage ? ` · day ${atStage.day}/${atStage.total}` : ''} · {formatIsoDate(stage.startDate)} → {formatIsoDate(stage.endDate)}
              </span>
            </span>
            {onEditLeg && (
              <span className="flex-none font-mono text-2xs tracking-[0.08em] uppercase text-accent-ink">Edit ›</span>
            )}
          </button>
        )
      ) : (
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="m-0 font-serif text-xl">
            Day {cell?.dayNumber ?? '—'}
            {totalDays !== null && <span className="text-faint"> / {totalDays}</span>}
          </h2>
          <span className="font-mono text-xs text-muted">
            {formatIsoDate(date)}
          </span>
          {stage && (
            <span className="font-mono text-2xs text-accent-ink">
              {stage.name}
              {atStage ? ` · day ${atStage.day}/${atStage.total}` : ''}
            </span>
          )}
        </div>
      )}

      {sheet && posts.length > 0 && (
        <span className={`${legend} pt-1`}>
          Told from this day
          <span className="normal-case tracking-normal text-faint">
            {' '}· {published} published{drafts > 0 ? ` · ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}
          </span>
        </span>
      )}

      {posts.length === 0 ? (
        <p className="m-0 text-sm text-muted">
          Nothing told from this day yet.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col">
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              cell={cell}
              thumb={thumbs.get(post.id) ?? null}
              compact={sheet}
              onUpdate={onUpdatePost}
              onDuplicate={() => onAddPost(duplicateTripPost(post))}
              onDelete={() => onDeletePost(post.id)}
              onOpen={() => onOpenPost(post)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <span className={`${legend} ${sheet ? '' : 'pt-3'}`}>Tell this day</span>
        <div className={`flex items-center gap-2 ${sheet ? '' : 'flex-wrap'}`}>
          {POST_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => onStartPost(k.id)}
              title={`${k.hint} — opens straight away`}
              className={`${
                sheet ? 'flex-1 min-h-[44px] px-2' : 'px-3.5 py-2'
              } rounded-full border border-ink bg-ink text-paper text-xs font-semibold cursor-pointer transition-colors hover:bg-accent hover:border-accent`}
            >
              {k.label}
            </button>
          ))}
          {!sheet && (
            <span className="text-xs text-muted">
              It opens straight away — name it and dress it there.
            </span>
          )}
        </div>
        {sheet && (
          <span className="text-xs text-muted">It opens straight away — name it and dress it there.</span>
        )}
      </div>
    </section>
  );
}
