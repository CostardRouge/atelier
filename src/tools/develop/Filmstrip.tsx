import { useEffect, useRef } from 'react';
import { describeDevelop } from '../../shared/develop/develop';
import type { SelectionModifiers } from '../../shared/develop/roll-editor';
import type { PictureAvailability } from '../../shared/develop/roll-media';
import type { RollPicture } from '../../shared/develop/roll-types';
import { useObjectUrl } from '../../shared/media/use-object-url';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import WinnowThumb from '../../shared/sources/winnow/WinnowThumb';
import { Icons } from '../../shared/ui/icons';

/**
 * The roll's pictures in a band under the stage, in the strip's order: a
 * plain click opens one (outlined, kept in view as ←/→ step), Shift or ⌘/Ctrl
 * marks it for a batch instead (D7 of `docs/develop-tool.md`) — a checkmark
 * badge, never a second ring colour that would fight the open one. A corner ×
 * takes a picture off the roll. Adding is the bar's verb, never a second copy
 * here.
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
      {pictures.map((p) => (
        <Cell
          key={p.id}
          picture={p}
          open={p.id === openId}
          selected={selectedIds.has(p.id)}
          thumb={thumbs.get(p.id) ?? null}
          availability={availability.get(p.id)}
          remote={thumbs.has(p.id) ? null : remoteThumb(p)}
          size={size}
          onOpen={() => onOpen(p.id)}
          onSelectClick={(mods) => onSelectClick(p.id, mods)}
          onRemove={() => onRemove(p)}
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
  remote,
  size,
  onOpen,
  onSelectClick,
  onRemove,
}: {
  picture: RollPicture;
  open: boolean;
  selected: boolean;
  thumb: Blob | null;
  availability: PictureAvailability | undefined;
  remote: { client: WinnowClient; id: number } | null;
  size: string;
  onOpen: () => void;
  onSelectClick: (mods: SelectionModifiers) => void;
  onRemove: () => void;
}) {
  const url = useObjectUrl(thumb);
  const developed = picture.develop !== null || picture.framing !== null;
  const kind = availability?.kind ?? 'local';
  const fetching = kind === 'fetching';
  const unreachable = kind === 'failed' || kind === 'gone' || kind === 'unconnected' || kind === 'local';
  return (
    <li className="group relative flex-none" data-picture={picture.id}>
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
        aria-label={`${picture.ref.name}${developed ? ', developed' : ''}${selected ? ', selected' : ''}${
          fetching ? ', fetching' : unreachable ? ', not available' : ''
        }`}
        title={`${picture.ref.name}${developed ? ` — ${describeDevelop(picture.develop) || 'cropped'}` : ' — as shot'} — Shift or ⌘/Ctrl-click to select for a batch`}
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
            <span className="w-4 h-4 rounded-full border-2 border-[rgba(251,248,241,0.3)] border-t-[rgba(251,248,241,0.95)] animate-spin motion-reduce:animate-none" />
          </span>
        )}
        {unreachable && url && (
          <span
            className="absolute right-1 bottom-1 w-4 h-4 grid place-items-center rounded-full bg-surface border border-line-strong font-mono text-3xs text-danger"
            aria-hidden="true"
          >
            !
          </span>
        )}
        {developed && (
          <span className="absolute left-1 bottom-1 w-1.5 h-1.5 rounded-full bg-accent ring-1 ring-[rgba(20,18,15,0.6)]" aria-hidden="true" />
        )}
        {selected && (
          <span
            className="absolute left-1 top-1 w-4 h-4 grid place-items-center rounded-full bg-accent text-paper text-3xs"
            aria-hidden="true"
          >
            {Icons.check}
          </span>
        )}
      </button>
      {/* Hover reveals it where a pointer can hover; a touch screen shows it
          always, a size larger. It used to be `max-[820px]:hidden`, which
          took the roll's only way to drop a picture off the phone — and on
          a touch tablet above that width it was invisible yet tappable. */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1 -right-1 w-5 h-5 grid place-items-center rounded-full border border-line-strong bg-surface font-mono text-2xs leading-none text-muted cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger pointer-coarse:opacity-100 pointer-coarse:w-7 pointer-coarse:h-7 pointer-coarse:text-sm"
        aria-label={`Take ${picture.ref.name} off the roll`}
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
