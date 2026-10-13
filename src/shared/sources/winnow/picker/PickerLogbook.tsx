import type { MouseEvent, ReactNode } from 'react';
import type { WinnowClient } from '../client';
import { localClock } from '../capture-moment';
import CullMark from '../CullMark';
import WinnowThumb from '../WinnowThumb';
import { formatDuration } from '../../../lib/format';
import { Icons } from '../../../ui/icons';
import type { FlightTrack } from './flight-track';
import type { PickItem } from './pick-filter';
import { dayHeading, dayRuns, rowDay } from './span';
import TrackGlyph from './TrackGlyph';

const head = 'sticky top-0 z-[2] bg-surface px-2 max-[820px]:px-1 py-1.5 font-mono text-3xs font-normal uppercase tracking-[0.1em] text-muted text-left';
const num = 'font-mono tabular-nums text-right';

/**
 * The picker's LOGBOOK view: the same rows as the grid, one line each, read
 * like a pilot's logbook — take-off time, place, length, the body and the
 * file with its log — and, once its log is read, the flight's own TRACK where
 * the thumbnail would be, with its distance and its highest point
 * (`flight-track.ts`). Everything but the track comes from the row Winnow
 * sent; a clip nobody asked to read keeps its thumbnail.
 *
 * Same ticks as the grid: a click ticks (⇧ for a range), a double click or
 * Space on the tick looks at it large.
 */
export default function PickerLogbook({
  items,
  grouped,
  client,
  ticked,
  focusId,
  heldLabel,
  tracks,
  reading,
  onToggle,
  onLook,
  more,
}: {
  items: readonly PickItem[];
  /** Day headings between consecutive days (a span, a folder, by time). */
  grouped: boolean;
  client: WinnowClient;
  ticked: ReadonlySet<number>;
  focusId: number | null;
  heldLabel: string;
  /** Tracks read so far, by row id; null for a log that holds no fix. */
  tracks: ReadonlyMap<number, FlightTrack | null>;
  /** Whether tracks are being read for the rows drawn. */
  reading: boolean;
  onToggle: (it: PickItem, e: MouseEvent) => void;
  onLook: (id: number) => void;
  /** The batch sentinel, drawn after the last row. */
  more: ReactNode;
}) {
  const runs = grouped ? dayRuns(items, (it) => rowDay(it.row)) : [{ day: null, items: [...items] }];
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className={`${head} w-8`}>
            <span className="sr-only">Ticked</span>
          </th>
          <th className={`${head} w-24 max-[820px]:w-16`}>Track</th>
          <th className={head}>Take-off</th>
          <th className={`${head} max-[820px]:hidden`}>Place</th>
          <th className={`${head} text-right`}>Length</th>
          <th className={`${head} text-right`}>Distance</th>
          <th className={`${head} text-right max-[820px]:hidden`}>Highest</th>
          <th className={`${head} max-[820px]:hidden`}>Body</th>
          <th className={`${head} max-[820px]:hidden`}>File</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run, k) => [
          grouped ? (
            <tr key={`day-${k}`} data-day={run.day ?? undefined}>
              <th colSpan={9} className="px-2 pt-3 pb-1 text-left text-xs font-semibold border-b border-line-strong">
                {run.day ? dayHeading(run.day) : 'No date'}
                <span className="ml-2 font-mono text-3xs font-normal text-muted tabular-nums">
                  {run.items.filter((it) => it.log === 'with').length} flights logged · {run.items.length} media
                </span>
              </th>
            </tr>
          ) : null,
          ...run.items.map((it) => {
            const on = ticked.has(it.id);
            const track = tracks.get(it.id);
            const { row } = it;
            return (
              <tr
                key={it.id}
                onClick={(e) => onToggle(it, e)}
                onDoubleClick={() => onLook(it.id)}
                className={`border-b border-line ${it.held ? 'opacity-45 cursor-default' : 'cursor-pointer'} ${
                  on ? 'bg-accent-wash' : 'hover:bg-paper-2'
                } ${focusId === it.id ? 'outline-2 -outline-offset-2 outline-ink' : ''}`}
              >
                <td className="px-2 max-[820px]:px-1 py-1">
                  <button
                    type="button"
                    disabled={it.held}
                    aria-pressed={it.held ? undefined : on}
                    aria-label={`${row.filename}${it.held ? `, ${heldLabel}` : on ? ', ticked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(it, e);
                    }}
                    // Space looks, as on a tile; the button would click on the release.
                    onKeyDown={(e) => {
                      if (e.key !== ' ') return;
                      e.preventDefault();
                      if (!e.repeat) onLook(it.id);
                    }}
                    onKeyUp={(e) => {
                      if (e.key === ' ') e.preventDefault();
                    }}
                    className={`w-4 h-4 grid place-items-center rounded-[4px] border p-0 cursor-pointer disabled:cursor-default [&_svg]:w-2.5 [&_svg]:h-2.5 ${
                      on ? 'bg-accent border-accent text-paper' : 'bg-surface border-line-strong text-transparent'
                    }`}
                  >
                    {Icons.check}
                  </button>
                </td>
                <td className="px-2 max-[820px]:px-1 py-1">
                  <span className="relative block w-20 h-11 max-[820px]:w-14 max-[820px]:h-9 rounded-[6px] overflow-hidden bg-paper-2">
                    {track ? (
                      <TrackGlyph track={track} className="w-full h-full text-accent" />
                    ) : (
                      <>
                        <WinnowThumb client={client} id={row.id} label={row.ext || it.kind} box="w-full h-full" />
                        {it.log === 'with' && (
                          <span className="absolute right-1 bottom-1 px-1 rounded-sm bg-surface/85 text-ink font-mono text-3xs leading-[14px]">
                            {track === null ? 'no fix' : reading ? '…' : 'SRT'}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </td>
                <td className="px-2 max-[820px]:px-1 py-1 font-mono tabular-nums whitespace-nowrap">
                  {localClock(row) ?? '—'}
                  {it.held && <span className="ml-1.5 text-3xs text-muted max-[820px]:hidden">{heldLabel}</span>}
                </td>
                <td className="px-2 max-[820px]:px-1 py-1 max-[820px]:hidden truncate max-w-[10rem]">
                  {row.place_city ?? row.place_region ?? <span className="text-faint">—</span>}
                </td>
                <td className={`px-2 max-[820px]:px-1 py-1 ${num} whitespace-nowrap`}>
                  {it.kind === 'video' ? (row.duration_s ? formatDuration(row.duration_s) : '—') : <span className="text-faint uppercase">{it.ext}</span>}
                </td>
                <td className={`px-2 max-[820px]:px-1 py-1 ${num} whitespace-nowrap`}>
                  {track?.km != null ? `${track.km.toFixed(2)} km` : <span className="text-faint">—</span>}
                </td>
                <td className={`px-2 max-[820px]:px-1 py-1 ${num} whitespace-nowrap max-[820px]:hidden`}>
                  {track?.maxHeightM != null ? `${Math.round(track.maxHeightM)} m` : <span className="text-faint">—</span>}
                </td>
                <td className="px-2 max-[820px]:px-1 py-1 max-[820px]:hidden truncate max-w-[9rem] text-ink-soft">{it.device ?? '—'}</td>
                <td className="px-2 max-[820px]:px-1 py-1 max-[820px]:hidden">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-2xs truncate">{row.filename}</span>
                    <CullMark culling={it.culling ?? undefined} />
                  </span>
                </td>
              </tr>
            );
          }),
        ])}
        {more && (
          <tr>
            <td colSpan={9} className="p-0">
              {more}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
