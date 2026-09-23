import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { describeDevelop } from '../../shared/develop/develop';
import type { SelectionModifiers } from '../../shared/develop/roll-editor';
import type { PictureAvailability } from '../../shared/develop/roll-media';
import {
  deliverState,
  delivers,
  isIgnored,
  pictureEdits,
  pictureLabel,
  variantNumber,
  type PictureEdit,
  type RollPicture,
} from '../../shared/develop/roll-types';
import { useObjectUrl } from '../../shared/media/use-object-url';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { describeCulling, type Culling } from '../../shared/sources/winnow/culling';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import { Icons } from '../../shared/ui/icons';
import CullMark from './CullMark';
import type { DeliverAction } from './PictureWorkbench';

/**
 * The roll's pictures in a band under the stage, in the strip's order: a
 * plain click opens one (outlined, kept in view as ←/→ step), Shift or ⌘/Ctrl
 * marks it for a batch instead (D7 of `docs/develop-tool.md`) — a checkmark
 * badge, never a second ring colour that would fight the open one. A corner ×
 * takes a picture off the roll. Adding is the bar's verb, never a second copy
 * here.
 *
 * Each cell also carries its DELIVERY badge (E3 of `docs/lightroom-gaps.md`
 * §10): a click sends ↔ holds, a right-click or a held finger ignores, and an
 * ignored cell is dimmed — or left out entirely when the author hides them
 * (never the open one: the stage must stay in the strip).
 *
 * And Winnow's CULLING, read-only (item 33 of `docs/lightroom-gaps.md`): a
 * pick flag, the stars and a label dot along the cell's top edge, and a
 * `shows` filter the roll's status line sets — a picture that fails it leaves
 * the strip, the open one excepted.
 */
export default function Filmstrip({
  pictures,
  openId,
  selectedIds,
  thumbs,
  availability,
  remoteThumb,
  compact,
  onOpen,
  onSelectClick,
  onRemove,
  onDeliver,
  hideIgnored = false,
  culling,
  shows = () => true,
}: {
  pictures: readonly RollPicture[];
  openId: string | null;
  selectedIds: ReadonlySet<string>;
  thumbs: ReadonlyMap<string, Blob>;
  /** Where each picture's bytes stand — a cell says it, the stage explains it. */
  availability: ReadonlyMap<string, PictureAvailability>;
  /** The instance's thumbnail, for a cell that has none of its own yet. */
  remoteThumb: (picture: RollPicture) => { client: WinnowClient; id: number } | null;
  compact: boolean;
  onOpen: (id: string) => void;
  onSelectClick: (id: string, mods: SelectionModifiers) => void;
  onRemove: (picture: RollPicture) => void;
  /** The delivery badge's gestures — `RollEditor.handleDeliver`. */
  onDeliver: (id: string, action: DeliverAction) => void;
  /** Leave ignored pictures out of the strip (the open one always stays). */
  hideIgnored?: boolean;
  /** Winnow's word on each picture it answered for (`use-roll-culling.ts`). */
  culling?: ReadonlyMap<string, Culling>;
  /** Whether a picture passes the strip's filter — Winnow's, today. The open one always stays. */
  shows?: (picture: RollPicture) => boolean;
}) {
  const stripRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const cell = openId ? stripRef.current?.querySelector<HTMLElement>(`[data-picture="${CSS.escape(openId)}"]`) : null;
    cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [openId]);

  const size = compact ? 'w-14 h-14' : 'w-[4.5rem] h-[4.5rem]';
  return (
    <ol
      ref={stripRef}
      aria-label="Pictures on this roll"
      // Claims only the axis it scrolls, so a finger on it can still move the page.
      // The room above and right is the × badge's: it overhangs its cell by
      // 4px, and a scroller that clips x clips y too — on a touch screen,
      // where the badge is always shown, its top was sliced flat.
      className="m-0 p-0 pt-1.5 pr-1.5 pb-1 list-none flex gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:thin]"
    >
      {pictures.filter((p) => p.id === openId || ((!hideIgnored || !isIgnored(p)) && shows(p))).map((p) => (
        <Cell
          key={p.id}
          picture={p}
          open={p.id === openId}
          selected={selectedIds.has(p.id)}
          thumb={thumbs.get(p.id) ?? null}
          availability={availability.get(p.id)}
          culling={culling?.get(p.id)}
          remote={thumbs.has(p.id) ? null : remoteThumb(p)}
          size={size}
          onOpen={() => onOpen(p.id)}
          onSelectClick={(mods) => onSelectClick(p.id, mods)}
          onRemove={() => onRemove(p)}
          onDeliver={(action) => onDeliver(p.id, action)}
        />
      ))}
    </ol>
  );
}

function Cell({
  picture,
  open,
  selected,
  thumb,
  availability,
  culling,
  remote,
  size,
  onOpen,
  onSelectClick,
  onRemove,
  onDeliver,
}: {
  picture: RollPicture;
  open: boolean;
  selected: boolean;
  thumb: Blob | null;
  availability: PictureAvailability | undefined;
  culling: Culling | undefined;
  remote: { client: WinnowClient; id: number } | null;
  size: string;
  onOpen: () => void;
  onSelectClick: (mods: SelectionModifiers) => void;
  onRemove: () => void;
  onDeliver: (action: DeliverAction) => void;
}) {
  const url = useObjectUrl(thumb);
  const ignored = isIgnored(picture);
  // The roll's one answer (`pictureEdits`): the dot, the progress line and the
  // remove confirmation cannot disagree about what counts.
  const edits = pictureEdits(picture);
  const developed = edits.length > 0;
  const kind = availability?.kind ?? 'local';
  const label = pictureLabel(picture);
  const variant = variantNumber(picture);
  const fetching = kind === 'fetching';
  const unreachable = kind === 'failed' || kind === 'gone' || kind === 'unconnected' || kind === 'local';
  return (
    <li className={`group relative flex-none ${ignored && !open ? 'opacity-35 hover:opacity-70' : ''}`} data-picture={picture.id}>
      <button
        type="button"
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            onSelectClick({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
          } else {
            onOpen();
          }
        }}
        aria-current={open ? 'true' : undefined}
        aria-selected={selected ? 'true' : undefined}
        aria-label={`${label}${developed ? ', developed' : ''}${selected ? ', selected' : ''}${
          fetching ? ', fetching' : unreachable ? ', not available' : ''
        }`}
        title={`${label}${variant > 1 ? ' (a variant)' : ''}${developed ? ` — ${editSummary(picture.develop, edits)}` : ' — as shot'}${
          culling && describeCulling(culling) ? ` — Winnow: ${describeCulling(culling)}` : ''
        } — Shift or ⌘/Ctrl-click to select for a batch`}
        className={`relative block ${size} p-0 rounded-paper overflow-hidden bg-frame cursor-pointer border-2 ${
          open ? 'border-accent' : 'border-transparent hover:border-line-strong'
        }`}
      >
        {url ? (
          <img
            src={url}
            alt=""
            className={`block w-full h-full object-cover ${unreachable ? 'opacity-45 grayscale' : ''}`}
          />
        ) : remote && (kind === 'waiting' || kind === 'fetching') ? (
          <WinnowThumb client={remote.client} id={remote.id} label={CELL_WORDS[kind]} box="w-full h-full" />
        ) : (
          <span className="absolute inset-0 grid place-items-center px-1 text-center font-mono text-3xs leading-tight text-muted">
            {CELL_WORDS[kind]}
          </span>
        )}
        {fetching && (
          <span className="absolute inset-0 grid place-items-center bg-[rgba(13,12,10,0.5)]" aria-hidden="true">
            <span className="w-4 h-4 rounded-full border-2 border-on-media/30 border-t-on-media/95 animate-spin motion-reduce:animate-none" />
          </span>
        )}
        {unreachable && url && (
          <span
            className="absolute right-1 top-1 w-4 h-4 grid place-items-center rounded-full bg-surface border border-line-strong font-mono text-3xs text-danger"
            aria-hidden="true"
          >
            !
          </span>
        )}
        {/* A variant says its number where the edited dot sits, the dot
            beside it — a copy of a picture is read as a copy at a glance. */}
        {variant > 1 && (
          <span
            className="absolute left-1 bottom-1 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-surface/85 font-mono text-3xs leading-none text-ink"
            aria-hidden="true"
          >
            {variant}
          </span>
        )}
        {developed && (
          <span
            className={`absolute w-1.5 h-1.5 rounded-full bg-accent ring-1 ring-[rgba(20,18,15,0.6)] ${variant > 1 ? 'left-6 bottom-2.5' : 'left-1 bottom-1'}`}
            aria-hidden="true"
          />
        )}
        {/* Winnow's word, between the two top corners (the selection check
            and the unreachable mark own those). Read-only: not a target. */}
        <span className="absolute left-1/2 -translate-x-1/2 top-1 pointer-events-none">
          <CullMark culling={culling} onMedia />
        </span>
        {selected && (
          <span
            className="absolute left-1 top-1 w-4 h-4 grid place-items-center rounded-full bg-accent text-paper text-3xs"
            aria-hidden="true"
          >
            {Icons.check}
          </span>
        )}
      </button>
      <DeliveryBadge picture={picture} name={label} onDeliver={onDeliver} />
      {/* Hover reveals it where a pointer can hover; a touch screen shows it
          always, a size larger. It used to be `max-[820px]:hidden`, which
          took the roll's only way to drop a picture off the phone — and on
          a touch tablet above that width it was invisible yet tappable. */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1 -right-1 w-5 h-5 grid place-items-center rounded-full border border-line-strong bg-surface font-mono text-2xs leading-none text-muted cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger pointer-coarse:opacity-100 pointer-coarse:w-7 pointer-coarse:h-7 pointer-coarse:text-sm"
        aria-label={`Take ${label} off the roll`}
        title="Take it off the roll — the file stays where it is"
      >
        ×
      </button>
    </li>
  );
}

/** What an empty cell says, in a word or two — the stage says the rest. */
const CELL_WORDS: Record<PictureAvailability['kind'], string> = {
  ready: '…',
  preview: '…',
  fetching: '',
  waiting: 'on its instance',
  failed: 'not fetched',
  gone: 'gone',
  unconnected: 'not connected',
  local: 'not open',
};

/** `+1.2 EV · contrast +10 · look · crop` — the develop's own numbers, then every other kind of edit by name. */
function editSummary(develop: RollPicture['develop'], edits: readonly PictureEdit[]): string {
  return [describeDevelop(develop), ...edits.filter((e) => e !== 'develop')].filter(Boolean).join(' · ');
}

/** How long a finger rests on the badge before it means "ignore". */
const HOLD_MS = 550;

/**
 * The cell's delivery state, and the gesture on it: a click sends ↔ holds
 * (`toggledDelivery`), a right-click or a held finger ignores ↔ brings back.
 * Filled means the author decided; dashed means the roll's rule answers. A
 * picture on the rule that stays out — the untouched majority of a big roll —
 * shows its badge only under the pointer (always on a touch screen), so the
 * strip does not wear a hundred grey rings.
 */
function DeliveryBadge({
  picture,
  name,
  onDeliver,
}: {
  picture: RollPicture;
  name: string;
  onDeliver: (action: DeliverAction) => void;
}) {
  const state = deliverState(picture);
  const ignored = state === 'ignore';
  const leaves = delivers(picture);
  const held = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const clear = () => {
    if (held.current.timer !== null) window.clearTimeout(held.current.timer);
    held.current.timer = null;
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    held.current.fired = false;
    if (e.pointerType !== 'touch') return;
    clear();
    held.current.timer = window.setTimeout(() => {
      held.current.fired = true;
      held.current.timer = null;
      onDeliver('ignore');
    }, HOLD_MS);
  };
  const look = ignored
    ? 'bg-surface/85 border border-line-strong text-muted'
    : leaves
      ? state === 'yes'
        ? 'bg-accent border border-accent text-white'
        : 'bg-surface/85 border-2 border-dashed border-accent text-accent-ink'
      : state === 'no'
        ? 'bg-surface/85 border border-ink-soft text-ink-soft'
        : 'bg-surface/70 border border-dashed border-line-strong text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100';
  const said = ignored ? 'ignored' : leaves ? 'leaves' : 'held back';
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onClick={(e) => {
        e.stopPropagation();
        // A held finger already ignored it: the click that ends the hold is not a second gesture.
        if (held.current.fired) {
          held.current.fired = false;
          return;
        }
        onDeliver(ignored ? 'ignore' : 'toggle');
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onDeliver('ignore');
      }}
      aria-label={`${name} ${said} — ${ignored ? 'bring it back' : leaves ? 'hold it back' : 'send it'}`}
      title={`${said[0].toUpperCase()}${said.slice(1)}${state === 'auto' && !ignored ? ' (the roll’s rule: edited pictures leave)' : ''} — click to ${
        ignored ? 'bring it back' : leaves ? 'hold it back' : 'send it'
      }; right-click or hold to ${ignored ? 'bring it back' : 'ignore it'}`}
      className={`absolute right-1 bottom-1 w-5 h-5 grid place-items-center rounded-full text-2xs cursor-pointer select-none touch-manipulation pointer-coarse:w-7 pointer-coarse:h-7 pointer-coarse:text-sm ${look}`}
    >
      <span className="inline-flex" aria-hidden="true">
        {ignored ? Icons.eyeOff : leaves ? Icons.arrowUp : Icons.minus}
      </span>
    </button>
  );
}
