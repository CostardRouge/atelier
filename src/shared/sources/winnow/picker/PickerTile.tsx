import type { MouseEvent } from 'react';
import type { WinnowClient } from '../client';
import CullMark from '../CullMark';
import WinnowThumb from '../WinnowThumb';
import { formatDuration } from '../../../lib/format';
import { Icons } from '../../../ui/icons';
import type { PickItem } from './pick-filter';

/** A chip ON the picture: its ground flips with its ink (`frontend.md`). */
const chip =
  'inline-flex items-center h-[18px] px-1.5 rounded-full bg-surface/85 text-ink font-mono text-3xs leading-none whitespace-nowrap';

export interface PileBadge {
  label: string;
  title: string;
  onClick: () => void;
}

/**
 * One media of the picker's grid: the instance's thumbnail, Winnow's word on
 * it (`CullMark` — flag, stars, label), what kind of file it is, and its tick.
 *
 * A held media (already on the roll, already in the Library) is drawn dimmed
 * with its host's word along the bottom and cannot be ticked — the same rule
 * the day sheet had, so a picture is never taken twice.
 */
export default function PickerTile({
  item,
  client,
  ticked,
  focused,
  heldLabel,
  pile,
  onToggle,
  onLook,
  className = '',
}: {
  item: PickItem;
  client: WinnowClient;
  ticked: boolean;
  focused: boolean;
  heldLabel: string;
  /** The pile's badge — on its cover, or `3/12` on an elected frame. */
  pile: PileBadge | null;
  onToggle: (e: MouseEvent) => void;
  /** Open it large (a double click; Space on the focused tile). */
  onLook: () => void;
  /** The cell's own size, where it is not a grid cell (a pile's row). */
  className?: string;
}) {
  const { row } = item;
  const isFinal = row.original_asset_id != null;
  const kindChip =
    item.kind === 'video'
      ? `▶ ${row.duration_s ? formatDuration(row.duration_s) : 'clip'}`
      : `${item.ext}${item.pairExt ? `+${item.pairExt}` : ''}`;
  return (
    <li className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        disabled={item.held}
        aria-pressed={item.held ? undefined : ticked}
        aria-label={`${row.filename}${item.held ? `, ${heldLabel}` : ticked ? ', ticked' : ''}`}
        title={`${row.filename}${row.device ? ` · ${row.device}` : ''}${item.tags.length ? ` · #${item.tags.join(' #')}` : ''}`}
        onClick={onToggle}
        onDoubleClick={onLook}
        // Space LOOKS, as in Winnow and Lightroom; a click ticks. The button
        // would otherwise click on the key's release, so both halves are
        // claimed.
        onKeyDown={(e) => {
          if (e.key !== ' ') return;
          e.preventDefault();
          if (!e.repeat) onLook();
        }}
        onKeyUp={(e) => {
          if (e.key === ' ') e.preventDefault();
        }}
        className={`relative block w-full h-full p-0 rounded-paper overflow-hidden bg-frame border-2 cursor-pointer disabled:cursor-default ${
          item.held
            ? 'border-transparent opacity-45'
            : ticked
              ? 'border-accent'
              : 'border-transparent [&_img]:opacity-75 hover:[&_img]:opacity-100'
        } ${focused ? 'outline-2 outline-offset-2 outline-ink' : ''}`}
      >
        <WinnowThumb client={client} id={row.id} label={row.ext || item.kind} box="w-full h-full" />
        {!item.held && (
          <span
            aria-hidden="true"
            className={`absolute left-1.5 top-1.5 w-5 h-5 grid place-items-center rounded-full border text-3xs [&_svg]:w-3 [&_svg]:h-3 ${
              ticked ? 'bg-accent border-accent text-paper' : 'bg-surface/80 border-line-strong text-transparent'
            }`}
          >
            {Icons.check}
          </span>
        )}
        <span className="absolute right-1.5 top-1.5 flex items-center gap-1">
          {(isFinal || (row.edit_count ?? 0) > 0) && (
            <span
              className={chip}
              title={isFinal ? 'A Gallery final' : `${row.edit_count} Gallery final${row.edit_count === 1 ? '' : 's'} link to it`}
            >
              {isFinal ? 'Final' : 'Gallery'}
            </span>
          )}
          <CullMark culling={item.culling ?? undefined} onMedia />
        </span>
        <span className="absolute left-1.5 right-1.5 bottom-1.5 flex items-center justify-end gap-1 overflow-hidden" aria-hidden="true">
          <span className={`${chip} uppercase`}>{kindChip}</span>
        </span>
        {item.held && (
          <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-[rgba(13,12,10,0.72)] font-mono text-3xs text-on-media text-left">
            {heldLabel}
          </span>
        )}
      </button>
      {pile && (
        // A sibling of the tile's button, not inside it: a button in a button
        // is invalid, and a click on the badge must not tick the picture.
        <button
          type="button"
          onClick={pile.onClick}
          title={pile.title}
          className={`${chip} absolute left-1.5 bottom-1.5 cursor-pointer hover:bg-surface`}
        >
          ▤ {pile.label}
        </button>
      )}
    </li>
  );
}
