import { useEffect, useMemo, useRef, useState } from 'react';
import { stageTint } from '../../shared/roadtrip/stage-ruler';
import { formatDayMonth, WEEKDAYS, weekdayIndex, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { ListGroup, ListRow } from '../../shared/roadtrip/trip-list';
import { stageLabel } from '../../shared/roadtrip/trip-places';
import { POST_KINDS, type TripPost } from '../../shared/roadtrip/trip-types';
import { Icons } from '../../shared/ui/icons';
import useDayThumbs from './use-day-thumbs';

const kindLabel = (post: TripPost) => POST_KINDS.find((k) => k.id === post.kind)?.label ?? post.kind;
/** `9 → 11 Mar` inside one month, `28 Feb → 2 Mar` across two. */
const spanText = (from: IsoDate, to: IsoDate) => {
  if (from === to) return formatDayMonth(from);
  const a = formatDayMonth(from);
  const b = formatDayMonth(to);
  return from.slice(0, 7) === to.slice(0, 7) ? `${a.split(' ')[0]} → ${b}` : `${a} → ${b}`;
};
const weekday = (iso: IsoDate) => {
  const i = weekdayIndex(iso);
  return i === null ? '' : WEEKDAYS[i];
};

/**
 * The overview's third middle, LIST (`trip-list.ts`): the trip top to bottom,
 * a header per stage — sticky, so a long stage still says where you are — a
 * row per told day with its pieces' own hooks, and one quiet row per run of
 * silent days. A row is the calendar cell's twin: a click opens that day in
 * the day panel (the strip on a phone), never the piece itself.
 *
 * The hooks are read only for the rows near the scroll, like the pictures
 * view reads only the months around the one on screen: a year of pieces is a
 * year of JPEGs in memory otherwise.
 */
export default function TripListView({
  groups,
  selected,
  onSelect,
  onOpenStage,
  compact,
}: {
  groups: readonly ListGroup[];
  selected: IsoDate | null;
  onSelect: (date: IsoDate) => void;
  /** Open a stage's card (its sheet on a phone). */
  onOpenStage: (id: string) => void;
  compact: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ReadonlySet<IsoDate>>(() => new Set());

  // Which told days are on screen or close to it — what the hooks are read for.
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const seen = new Set<IsoDate>();
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const e of entries) {
          const date = (e.target as HTMLElement).dataset.date as IsoDate;
          if (e.isIntersecting && !seen.has(date)) {
            seen.add(date);
            changed = true;
          } else if (!e.isIntersecting && seen.delete(date)) changed = true;
        }
        if (changed) setNear(new Set(seen));
      },
      { root, rootMargin: '800px 0px' },
    );
    for (const el of root.querySelectorAll('[data-list-day]')) io.observe(el);
    return () => io.disconnect();
  }, [groups]);
  const nearPosts = useMemo(
    () => groups.flatMap((g) => g.rows.flatMap((r) => (r.kind === 'day' && near.has(r.date) ? r.posts : []))),
    [groups, near],
  );
  const thumbs = useDayThumbs(nearPosts);

  // The open day is brought into view when it is moved from elsewhere (the
  // silence chip, the year map) — by scrolling THIS box, never an ancestor.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !selected) return;
    const row = [...root.querySelectorAll<HTMLElement>('[data-from]')].find(
      (el) => el.dataset.from! <= selected && selected <= el.dataset.to!,
    );
    if (!row) return;
    const top = row.offsetTop - root.offsetTop;
    const head = 56; // the sticky stage header
    if (top - head < root.scrollTop || top + row.offsetHeight > root.scrollTop + root.clientHeight) {
      root.scrollTo({ top: Math.max(0, top - head - 8) });
    }
  }, [selected]);

  if (!groups.length) return <p className="m-0 p-4 text-sm text-muted">The trip has no days.</p>;

  return (
    <div
      ref={scroller}
      className={`relative flex-1 min-h-0 overflow-y-auto overscroll-contain ${compact ? 'px-2 pb-3' : 'pr-1 pb-4'}`}
      aria-label="The trip as a list of its days"
    >
      {groups.map((g) => (
        <section key={`${g.from}-${g.stageIndex ?? 'none'}`} className="pb-3">
          <GroupHead group={g} onOpenStage={onOpenStage} />
          <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
            {g.rows.map((row) => (
              <li key={row.kind === 'day' ? row.date : `s-${row.from}`}>
                <Row row={row} selected={selected} onSelect={onSelect} thumbs={thumbs} compact={compact} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function GroupHead({ group: g, onOpenStage }: { group: ListGroup; onOpenStage: (id: string) => void }) {
  const span = spanText(g.from, g.to);
  const facts = `${span} · ${g.days} d · ${g.told} told`;
  const dot =
    g.stageIndex === null ? (
      <span className="flex-none w-2.5 h-2.5 rounded-full border-[1.5px] border-dashed border-faint" aria-hidden="true" />
    ) : (
      <span className="flex-none w-2.5 h-2.5 rounded-full" style={{ background: stageTint(g.stageIndex) }} aria-hidden="true" />
    );
  const name = g.stage ? stageLabel(g.stage) || 'Unnamed stage' : 'In no stage';
  return (
    <div className="sticky top-0 z-[1] -mx-1 px-1 pt-2 pb-2 bg-paper/95 backdrop-blur-[2px]">
      {g.stage ? (
        <button
          type="button"
          onClick={() => onOpenStage(g.stage!.id)}
          title="Open this stage"
          className="group w-full flex items-center gap-2.5 p-0 border-0 bg-transparent text-left cursor-pointer"
        >
          {dot}
          <span className="min-w-0 flex-1 flex items-baseline gap-2.5">
            <span className="min-w-0 truncate font-serif text-lg leading-tight text-ink group-hover:text-accent-ink">{name}</span>
            <span className="flex-none font-mono text-2xs text-muted">{facts}</span>
          </span>
          <span className="flex-none text-faint group-hover:text-accent-ink [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
            {Icons.chevronRight}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2.5">
          {dot}
          <span className="min-w-0 flex-1 flex items-baseline gap-2.5">
            <span className="min-w-0 truncate font-serif text-lg leading-tight text-muted">{name}</span>
            <span className="flex-none font-mono text-2xs text-muted">{facts}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function Row({
  row,
  selected,
  onSelect,
  thumbs,
  compact,
}: {
  row: ListRow;
  selected: IsoDate | null;
  onSelect: (date: IsoDate) => void;
  thumbs: ReadonlyMap<string, string>;
  compact: boolean;
}) {
  if (row.kind === 'silence') {
    const on = !!selected && row.from <= selected && selected <= row.to;
    return (
      <button
        type="button"
        data-from={row.from}
        data-to={row.to}
        onClick={() => onSelect(row.from)}
        title="Open the first of these days"
        className={`w-full flex items-center gap-3 pl-3 pr-3 py-1.5 border border-dashed rounded-paper text-left cursor-pointer bg-transparent ${
          on ? 'border-accent text-accent-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink-soft'
        }`}
      >
        <span className={`flex-none font-mono text-2xs tabular-nums ${compact ? 'w-[5rem]' : 'w-[6.5rem]'}`}>
          {spanText(row.from, row.to)}
        </span>
        <span className="flex-1 min-w-0 text-xs italic truncate">
          {row.count} day{row.count === 1 ? '' : 's'} silent
        </span>
      </button>
    );
  }

  const on = selected === row.date;
  const drafted = row.posts.length - row.published;
  return (
    <button
      type="button"
      data-list-day
      data-date={row.date}
      data-from={row.date}
      data-to={row.date}
      onClick={() => onSelect(row.date)}
      aria-current={on ? 'date' : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 border rounded-paper text-left cursor-pointer transition-colors ${
        on ? 'border-accent bg-accent-wash' : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      <span className={`flex-none flex flex-col leading-tight ${compact ? 'w-[5rem]' : 'w-[6.5rem]'}`}>
        <span className="font-mono text-3xs tracking-[0.12em] uppercase text-muted">{weekday(row.date)}</span>
        <span className="text-sm font-semibold text-ink">{formatDayMonth(row.date)}</span>
        <span className="font-mono text-2xs text-muted">Day {row.dayNumber}</span>
      </span>

      <span className={`flex-1 min-w-0 flex flex-wrap items-center ${compact ? 'gap-1.5' : 'gap-x-4 gap-y-2'}`}>
        {row.posts.map((post) => {
          const url = thumbs.get(post.id);
          const published = post.publishedAt !== null;
          return (
            <span key={post.id} className="min-w-0 flex items-center gap-2.5">
              <span className="flex-none w-11 h-11 rounded-[8px] overflow-hidden border border-line bg-paper-2 grid place-items-center">
                {url ? (
                  <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
                ) : (
                  <span className="text-faint [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
                    {post.kind === 'reel' ? Icons.video : Icons.image}
                  </span>
                )}
              </span>
              {!compact && (
                <span className="min-w-0 flex flex-col leading-tight">
                  <span className="text-sm text-ink truncate max-w-[16rem]">{post.title.trim() || kindLabel(post)}</span>
                  <span className="text-2xs text-muted">
                    {kindLabel(post)} · {published ? <span className="text-ink-soft">published</span> : 'draft'}
                  </span>
                </span>
              )}
            </span>
          );
        })}
        {compact && (
          <span className="ml-1 text-2xs text-muted">
            {row.posts.length} piece{row.posts.length === 1 ? '' : 's'}
            {row.published ? ` · ${row.published} published` : ''}
            {drafted && row.published ? ` · ${drafted} draft${drafted === 1 ? '' : 's'}` : ''}
          </span>
        )}
      </span>

      <span className="flex-none text-faint [&>svg]:w-4 [&>svg]:h-4" aria-hidden="true">
        {Icons.chevronRight}
      </span>
    </button>
  );
}
