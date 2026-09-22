import { WEEKDAYS, formatIsoDate, weekdayIndex, type IsoDate } from '../../shared/roadtrip/trip-days';
import type { DayCell } from '../../shared/roadtrip/trip-coverage';
import type { DayStage } from './DayHeatmap';

interface DayStripProps {
  date: IsoDate;
  cell: DayCell | null;
  /** The leg the day belongs to, for its line. */
  stage: DayStage | null;
  /** The pieces' hooks, by post id (`useDayThumbs`). */
  thumbs: ReadonlyMap<string, string>;
  /** Pull the day up — the sheet with its pieces and its verbs. */
  onOpen: () => void;
}

/** How many hooks the strip shows before it counts the rest. */
const SHOWN = 3;

/**
 * The open day, as one strip above the shell's bottom bar — always there on a
 * phone, never scrolling: a tap on a calendar cell SELECTS the day and this is
 * what changes, so sweeping the calendar never opens a sheet over the thing
 * being swept (`docs/roadtrip-overview-mobile.md` §8.2).
 *
 * It is a PREVIEW: the date, the leg, and the day's pieces as their own hook
 * thumbnails at their own frame — a reel narrow, a carousel wider, the shape
 * being what the picture is for — three at most, then `+N`. The sheet is the
 * list. A day nothing came out of carries the verb instead of the pictures:
 * telling a day is the tool's commonest gesture, and making it cost a sheet
 * would be the wrong economy.
 */
export default function DayStrip({ date, cell, stage, thumbs, onOpen }: DayStripProps) {
  const posts = cell?.posts ?? [];
  const wd = weekdayIndex(date);
  const when = `${wd === null ? '' : WEEKDAYS[wd] + ' '}${formatIsoDate(date)}`;
  const shown = posts.slice(0, SHOWN);
  const rest = posts.length - shown.length;
  const line = stage
    ? `${stage.label ? stage.label + ' · ' : ''}day ${stage.day}/${stage.total}`
    : posts.length === 0
      ? 'nothing told yet'
      : '';

  return (
    <div
      className="flex-none flex items-stretch border-t border-line-strong bg-surface shadow-[0_-10px_22px_-20px_rgba(43,33,18,0.55)]"
      aria-label={`${when}, the open day`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${when} — ${posts.length ? `${posts.length} piece${posts.length === 1 ? '' : 's'}` : 'nothing told yet'}`}
        className="flex-1 min-w-0 flex items-center gap-2.5 px-3 pt-1.5 pb-2 border-0 bg-transparent text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink"
      >
        <span className="flex-1 min-w-0">
          {/* The grab hint: the strip pulls up into the sheet. */}
          <span className="block w-7 h-[3px] mb-1 rounded-full bg-line-strong" aria-hidden="true" />
          <span className="block text-sm font-semibold leading-tight truncate">
            {when}
            <span className="font-normal text-muted"> · day {cell?.dayNumber ?? '—'}</span>
          </span>
          <span className="flex items-center gap-1.5 mt-0.5 text-xs text-muted truncate">
            {stage && (
              <span
                className="flex-none w-[7px] h-[7px] rounded-full"
                style={{ background: stage.tint }}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{line}</span>
          </span>
        </span>

        {posts.length > 0 && (
          <span className="flex-none flex items-center gap-1" aria-hidden="true">
            {shown.map((post) => {
              const url = thumbs.get(post.id);
              const published = post.publishedAt !== null;
              return (
                <span
                  key={post.id}
                  className={`h-[34px] rounded-[3px] overflow-hidden bg-paper-2 border ${
                    published ? 'border-accent-ink' : 'border-dashed border-line-strong'
                  }`}
                >
                  {url ? (
                    <img src={url} alt="" className="h-full w-auto max-w-[40px] object-contain block" draggable={false} />
                  ) : (
                    <span className="block h-full w-[20px]" />
                  )}
                </span>
              );
            })}
            {rest > 0 && (
              <span className="grid place-items-center h-[34px] px-1.5 rounded-[3px] bg-paper-2 font-mono text-2xs text-ink-soft">
                +{rest}
              </span>
            )}
            <span className="ml-0.5 font-mono text-xs text-ink-soft">{posts.length}</span>
            <span className="text-faint">›</span>
          </span>
        )}
      </button>

      {posts.length === 0 && (
        <span className="flex-none flex items-center pr-3">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center h-[2.125rem] px-3.5 rounded-control border border-ink bg-ink text-paper text-xs font-semibold cursor-pointer transition-colors hover:bg-accent hover:border-accent"
          >
            + Tell it
          </button>
        </span>
      )}
    </div>
  );
}
