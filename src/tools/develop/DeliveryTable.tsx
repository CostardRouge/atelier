import { useState, type KeyboardEvent } from 'react';
import {
  deliverState,
  delivers,
  isIgnored,
  matchesDeliveryFilter,
  type DeliveryFilter,
  type RollPicture,
} from '../../shared/develop/roll-types';
import { exportState, needsExport, type ExportMarks } from '../../shared/develop/export-marks';
import { useObjectUrl } from '../../shared/media/use-object-url';
import { Icons } from '../../shared/ui/icons';
import type { DeliverAction } from './PictureWorkbench';

/** The table's filters: the roll's four, and E4's — what leaves and was never exported, or changed since. */
type TableFilter = DeliveryFilter | 'changed';

const FILTERS: readonly { id: TableFilter; label: string; title?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'edited', label: 'Edited' },
  { id: 'leaving', label: 'Leaving' },
  { id: 'held', label: 'Held' },
  { id: 'changed', label: 'Changed', title: 'Leaving, and never exported from this device or edited since' },
];

function matches(p: RollPicture, filter: TableFilter, marks: ExportMarks): boolean {
  if (filter === 'changed') return matchesDeliveryFilter(p, 'leaving') && needsExport(p, marks);
  return matchesDeliveryFilter(p, filter);
}

/** When a picture last left, as a reader says it: a time today, else a date. */
function when(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** What a stored state says, beside the name — only when the author, not the rule, decided. */
const PINNED: Record<string, string> = { yes: 'send', no: 'hold' };

/**
 * Which pictures an export takes, one ROW per picture (`docs/lightroom-gaps.md`
 * §10, E2): the run plan's own line for each, and a tick. The WHOLE row is the
 * target — 48 px, a finger's worth — never the tick alone, which is a target
 * nobody hits on a phone (his words). A click gives the other answer
 * (`toggledDelivery`); `↺` puts a picture the author decided back on the roll's
 * rule; the arrow opens it. Ignored pictures are folded into their own group
 * at the bottom, a row there bringing the picture back into the work — and the
 * group opens by itself when the picture on the stage is one of them.
 */
export default function DeliveryTable({
  pictures,
  openId,
  lines,
  thumbs,
  onDeliver,
  onOpen,
  marks = {},
}: {
  pictures: readonly RollPicture[];
  openId: string | null;
  /** Each picture's run-plan line, by id — what it would leave from and at what size. */
  lines: ReadonlyMap<string, string>;
  thumbs: ReadonlyMap<string, Blob>;
  onDeliver: (id: string, action: DeliverAction) => void;
  onOpen: (id: string) => void;
  /** When each picture last left from this device (`export-marks.ts`, E4). */
  marks?: ExportMarks;
}) {
  const [filter, setFilter] = useState<TableFilter>('all');
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const shown = pictures.filter((p) => matches(p, filter, marks));
  const ignored = pictures.filter(isIgnored);
  const openIgnored = ignored.some((p) => p.id === openId);
  const unfolded = ignoredOpen || openIgnored;
  const leaving = pictures.filter(delivers).length;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            title={f.title}
            onClick={() => setFilter(f.id)}
            className={`px-2 py-0.5 rounded-full border font-mono text-3xs cursor-pointer ${
              filter === f.id ? 'border-accent text-accent-ink' : 'border-line-strong text-muted hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-3xs text-faint tabular-nums">
          {leaving} of {pictures.length - ignored.length} leave
        </span>
      </div>
      <div className="flex flex-col border-t border-line">
        {shown.map((p) => (
          <Row key={p.id} picture={p} open={p.id === openId} line={lines.get(p.id)} thumb={thumbs.get(p.id) ?? null} marks={marks} onDeliver={onDeliver} onOpen={onOpen} />
        ))}
        {shown.length === 0 && (
          <p className="m-0 py-3 font-mono text-3xs text-faint">No picture on this roll answers “{FILTERS.find((f) => f.id === filter)?.label}”.</p>
        )}
        {ignored.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={unfolded}
              onClick={() => setIgnoredOpen((o) => !o)}
              className="flex items-center gap-1.5 min-h-9 px-1 border-b border-line bg-transparent text-left font-sans text-3xs font-semibold uppercase tracking-wider text-muted cursor-pointer hover:text-ink"
            >
              <span aria-hidden="true">{unfolded ? '▾' : '▸'}</span> Ignored · {ignored.length}
            </button>
            {unfolded &&
              ignored.map((p) => (
                <Row key={p.id} picture={p} open={p.id === openId} line={lines.get(p.id)} thumb={thumbs.get(p.id) ?? null} marks={marks} onDeliver={onDeliver} onOpen={onOpen} />
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  picture,
  open,
  line,
  thumb,
  marks,
  onDeliver,
  onOpen,
}: {
  picture: RollPicture;
  open: boolean;
  line: string | undefined;
  thumb: Blob | null;
  marks: ExportMarks;
  onDeliver: (id: string, action: DeliverAction) => void;
  onOpen: (id: string) => void;
}) {
  const url = useObjectUrl(thumb);
  const state = deliverState(picture);
  // E4: said only once a picture has left from here — a roll never exported says nothing.
  const mark = marks[picture.id];
  const exported = mark ? exportState(picture, marks) : null;
  const ignored = state === 'ignore';
  const on = delivers(picture);
  const name = picture.ref.name;
  // The plan's line starts with the name the row already shows: `name ← …`
  // or `name — …`. The arrow says something (where the pixels come from) and
  // stays; the dash only joined the name.
  const said = line?.startsWith(`${name} `) ? line.slice(name.length + 1).replace(/^— /, '') : line;
  // An ignored row brings the picture back into the work; any other gives the other answer.
  const act = () => onDeliver(picture.id, ignored ? 'ignore' : 'toggle');
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      act();
    }
  };
  return (
    <div
      role="checkbox"
      aria-checked={on}
      aria-label={`${name}${ignored ? ', ignored' : ''}`}
      tabIndex={0}
      onClick={act}
      onKeyDown={onKey}
      title={ignored ? 'Ignored — click to bring it back into the roll' : on ? 'Leaves — click to hold it back' : 'Held back — click to send it'}
      className={`group flex items-center gap-2 min-h-12 px-1 border-b border-line cursor-pointer select-none hover:bg-paper focus-visible:outline-2 focus-visible:outline-accent ${
        open ? 'shadow-[inset_3px_0_0_var(--color-accent)]' : ''
      } ${on ? '' : 'text-faint'}`}
    >
      <span
        aria-hidden="true"
        className={`flex-none grid place-items-center w-5 h-5 rounded-[5px] border-2 ${
          ignored ? 'border-line-strong text-faint' : on ? 'bg-accent border-accent text-white' : 'border-line-strong'
        }`}
      >
        {ignored ? <span className="inline-flex text-xs">{Icons.eyeOff}</span> : on ? <span className="inline-flex text-xs">{Icons.check}</span> : null}
      </span>
      <span className="flex-none w-10 h-7 rounded-sm bg-frame overflow-hidden">
        {url && <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />}
      </span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`font-mono text-2xs truncate ${on ? 'text-ink' : ''}`}>{name}</span>
          {PINNED[state] && (
            <span className="flex-none px-1.5 rounded-full border border-line-strong font-mono text-3xs text-ink-soft">{PINNED[state]}</span>
          )}
          {mark && exported === 'changed' && (
            <span
              className="flex-none px-1.5 rounded-full border border-accent font-mono text-3xs text-accent-ink"
              title={`Exported ${when(mark.at)} — edited since`}
            >
              changed
            </span>
          )}
          {mark && exported === 'current' && (
            <span className="flex-none font-mono text-3xs text-faint" title="Exported from this device, unchanged since">
              ✓ {when(mark.at)}
            </span>
          )}
        </span>
        {said && <span className="font-mono text-3xs leading-snug line-clamp-2 break-words">{said}</span>}
      </span>
      {(state === 'yes' || state === 'no') && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeliver(picture.id, 'auto');
          }}
          title="Back to the roll's rule — edited pictures leave"
          aria-label={`${name}: back to the roll's rule`}
          className="flex-none min-w-8 min-h-8 grid place-items-center rounded-control bg-transparent border-0 text-accent-ink cursor-pointer hover:bg-accent-wash"
        >
          <span className="inline-flex text-base">{Icons.reset}</span>
        </button>
      )}
      {!open && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(picture.id);
          }}
          title="Open this picture"
          aria-label={`Open ${name}`}
          className="flex-none min-w-8 min-h-8 grid place-items-center rounded-control bg-transparent border-0 text-muted cursor-pointer hover:text-ink hover:bg-paper"
        >
          <span className="inline-flex text-base">{Icons.chevronRight}</span>
        </button>
      )}
    </div>
  );
}
