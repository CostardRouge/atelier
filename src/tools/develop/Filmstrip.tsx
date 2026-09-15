import { useEffect, useRef } from 'react';
import { describeDevelop } from '../../shared/develop/develop';
import type { RollPicture } from '../../shared/develop/roll-types';
import { useObjectUrl } from '../../shared/media/use-object-url';

/**
 * The roll's pictures in a band under the stage, in the strip's order: a click
 * opens one, the open one is outlined and kept in view as ←/→ step, and a
 * corner × takes one off the roll. Adding is the bar's verb, never a second
 * copy here. Selecting several for a batch is D7's (`docs/develop-tool.md`).
 */
export default function Filmstrip({
  pictures,
  openId,
  thumbs,
  inLibrary,
  compact,
  onOpen,
  onRemove,
}: {
  pictures: readonly RollPicture[];
  openId: string | null;
  thumbs: ReadonlyMap<string, Blob>;
  inLibrary: ReadonlyMap<string, File>;
  compact: boolean;
  onOpen: (id: string) => void;
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
      className="m-0 p-0 pb-1 list-none flex gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x"
    >
      {pictures.map((p) => (
        <Cell
          key={p.id}
          picture={p}
          open={p.id === openId}
          thumb={thumbs.get(p.id) ?? null}
          inLibrary={inLibrary.has(p.id)}
          size={size}
          onOpen={() => onOpen(p.id)}
          onRemove={() => onRemove(p)}
        />
      ))}
    </ol>
  );
}

function Cell({
  picture,
  open,
  thumb,
  inLibrary,
  size,
  onOpen,
  onRemove,
}: {
  picture: RollPicture;
  open: boolean;
  thumb: Blob | null;
  inLibrary: boolean;
  size: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const url = useObjectUrl(thumb);
  const developed = picture.develop !== null || picture.framing !== null;
  return (
    <li className="group relative flex-none" data-picture={picture.id}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? 'true' : undefined}
        aria-label={`${picture.ref.name}${developed ? ', developed' : ''}`}
        title={`${picture.ref.name}${developed ? ` — ${describeDevelop(picture.develop) || 'cropped'}` : ' — as shot'}`}
        className={`relative block ${size} p-0 rounded-paper overflow-hidden bg-frame cursor-pointer border-2 ${
          open ? 'border-accent' : 'border-transparent hover:border-line-strong'
        }`}
      >
        {url ? (
          <img src={url} alt="" className="block w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 grid place-items-center px-1 text-center font-mono text-3xs leading-tight text-muted">
            {inLibrary ? '…' : 'not in library'}
          </span>
        )}
        {developed && (
          <span className="absolute left-1 bottom-1 w-1.5 h-1.5 rounded-full bg-accent ring-1 ring-[rgba(20,18,15,0.6)]" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1 -right-1 w-5 h-5 grid place-items-center rounded-full border border-line-strong bg-surface font-mono text-2xs leading-none text-muted cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger max-[820px]:hidden"
        aria-label={`Take ${picture.ref.name} off the roll`}
        title="Take it off the roll — the file stays where it is"
      >
        ×
      </button>
    </li>
  );
}
