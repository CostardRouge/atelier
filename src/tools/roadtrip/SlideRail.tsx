import { useEffect, useState } from 'react';
import type { DeckSlide } from '../../shared/roadtrip/deck';

interface SlideRailProps {
  slides: DeckSlide[];
  /** Index into `slides` of the one on the stage. */
  index: number;
  /** The deck's frame, so a cell has the shape of what it holds. */
  aspect: number;
  includeCta: boolean;
  /** The picture a slide composes over, when the Library holds it. */
  fileFor: (slide: DeckSlide) => File | null;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: () => void;
  /** Indices into `post.slides`, content pictures only. */
  onMove: (from: number, to: number) => void;
  onIncludeCta: (on: boolean) => void;
}

/**
 * The deck, beside the picture instead of behind a tab.
 *
 * A carousel is the one thing about a piece you cannot see while you work on
 * it: the slide strip used to live on a Deck tab, so on any other tab the
 * piece looked like a single image. Here it sits next to the stage — a column
 * on a wide screen, a row when the editor stacks — and it is also where the
 * deck is BUILT: drag a picture to reorder, `+` to add one, `×` on the open
 * picture to drop it, and the closing card is a cell that turns itself on.
 *
 * Only the middle of a deck reorders. The hook opens the piece and the call
 * to action closes it; a deck where either drifted into the middle would stop
 * working, so neither is draggable.
 */
export default function SlideRail({
  slides,
  index,
  aspect,
  includeCta,
  fileFor,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  onIncludeCta,
}: SlideRailProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  return (
    <div
      className="flex-none flex flex-row gap-2 overflow-x-auto pb-1 @min-[860px]:flex-col @min-[860px]:w-[4.6rem] @min-[860px]:overflow-x-visible @min-[860px]:overflow-y-auto @min-[860px]:pb-0 @min-[860px]:pr-1"
      role="listbox"
      aria-label="The slides of this piece"
    >
      {slides.map((s, i) => {
        const ci = s.kind === 'content' ? i - 1 : -1;
        const open = i === index;
        const dropping = ci >= 0 && dragOver === ci && dragFrom !== ci;
        return (
          <div key={s.slideId ?? s.kind} className="flex-none flex flex-col items-center gap-1">
            <div className="relative">
              <button
                type="button"
                onClick={() => onSelect(i)}
                role="option"
                aria-selected={open}
                title={`${
                  s.kind === 'content'
                    ? `Picture ${s.position} — drag it, or move it with the arrow keys`
                    : s.kind === 'hook'
                      ? 'The hook — the picture that opens the piece'
                      : 'The closing card, shared by the whole trip'
                }\n${
                  s.medium === 'video'
                    ? `Goes out as ${s.seconds.toFixed(1)}s of video`
                    : 'Goes out as an image'
                }`}
                draggable={ci >= 0}
                onDragStart={(e) => {
                  if (ci < 0) return;
                  setDragFrom(ci);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox starts no drag at all without a payload.
                  e.dataTransfer.setData('text/plain', String(ci));
                }}
                onDragOver={(e) => {
                  if (ci < 0 || dragFrom === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOver(ci);
                }}
                onDrop={(e) => {
                  if (ci < 0 || dragFrom === null) return;
                  e.preventDefault();
                  onMove(dragFrom, ci);
                  setDragFrom(null);
                  setDragOver(null);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
                // Reordering must not be drag-only: a picture moves with the
                // arrow keys while its cell has focus, whichever way the rail
                // happens to be turned.
                onKeyDown={(e) => {
                  if (ci < 0 || e.altKey || e.metaKey || e.ctrlKey) return;
                  const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
                  const on = e.key === 'ArrowRight' || e.key === 'ArrowDown';
                  if (!back && !on) return;
                  e.preventDefault();
                  onMove(ci, back ? ci - 1 : ci + 1);
                }}
                style={{ aspectRatio: String(aspect) }}
                className={`relative block h-14 w-auto overflow-hidden rounded-[5px] border bg-frame transition-colors @min-[860px]:h-auto @min-[860px]:w-11 ${
                  ci >= 0 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                } ${dragFrom === ci && ci >= 0 ? 'opacity-50 ' : ''}${
                  dropping
                    ? 'border-accent border-dashed'
                    : open
                      ? 'border-accent shadow-[0_0_0_2px_var(--color-accent-wash)]'
                      : 'border-line-strong hover:border-accent'
                }`}
              >
                {s.kind === 'cta' ? (
                  <span className="absolute inset-0 grid place-items-center bg-paper-2 font-mono text-[0.5rem] leading-tight text-muted">
                    card
                  </span>
                ) : (
                  <SlidePreview file={fileFor(s)} />
                )}
                {/* The shape of the deck, readable without opening a slide: a
                    cell that carries its length is one that leaves as video.
                    It is the whole point of deciding the medium here rather
                    than at the door — a carousel mixing a clip and three
                    stills must say so at a glance. */}
                {s.medium === 'video' && (
                  <span className="absolute bottom-0 inset-x-0 py-[1px] bg-[rgba(16,15,13,0.68)] font-mono text-[0.5rem] leading-none text-center text-[#f4efe6] tabular-nums">
                    {s.seconds.toFixed(1).replace(/\.0$/, '')}s
                  </span>
                )}
              </button>
              {open && ci >= 0 && (
                <button
                  type="button"
                  onClick={onRemove}
                  aria-label={`Remove picture ${s.position} from this piece`}
                  title="Remove this picture from the deck"
                  className="absolute -top-1.5 -right-1.5 w-[1.15rem] h-[1.15rem] grid place-items-center rounded-full border border-line-strong bg-paper text-[0.7rem] leading-none text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
                >
                  ×
                </button>
              )}
            </div>
            <span
              className={`font-mono text-[0.56rem] tracking-[0.08em] uppercase ${
                open ? 'text-accent-ink' : 'text-muted'
              }`}
            >
              {s.kind === 'hook' ? 'Hook' : s.kind === 'cta' ? 'Closing' : s.position}
            </span>
          </div>
        );
      })}

      <div className="flex-none flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onAdd}
          title="Add the active picture to this deck"
          style={{ aspectRatio: String(aspect) }}
          className="h-14 w-auto grid place-items-center rounded-[5px] border border-dashed border-line-strong bg-paper text-[0.95rem] leading-none text-muted cursor-pointer hover:border-accent hover:text-accent-ink @min-[860px]:h-auto @min-[860px]:w-11"
        >
          +
        </button>
        <span className="font-mono text-[0.56rem] tracking-[0.08em] uppercase text-muted">
          Add
        </span>
      </div>

      {!includeCta && (
        <div className="flex-none flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => onIncludeCta(true)}
            title="Close this piece with the trip’s call to action"
            style={{ aspectRatio: String(aspect) }}
            className="h-14 w-auto grid place-items-center rounded-[5px] border border-dashed border-line-strong bg-paper text-[0.95rem] leading-none text-faint cursor-pointer hover:border-accent hover:text-accent-ink @min-[860px]:h-auto @min-[860px]:w-11"
          >
            +
          </button>
          <span className="font-mono text-[0.56rem] tracking-[0.08em] uppercase text-faint">
            Closing
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A cell's picture. Stills get their own frame; a clip would need a decode per
 * cell, so it shows the film glyph rather than paying for six seeks — the
 * frame a clip opens on is chosen on the Picture tab, over the whole width.
 */
function SlidePreview({ file }: { file: File | null }) {
  const isImage = Boolean(file && file.type.startsWith('image/'));
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !isImage) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, isImage]);

  if (url) {
    return <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />;
  }
  return (
    <span className="absolute inset-0 grid place-items-center text-[0.8rem] leading-none text-[#6b6459]">
      {file ? '▸' : '·'}
    </span>
  );
}
