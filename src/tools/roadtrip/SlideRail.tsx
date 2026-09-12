import { useState } from 'react';
import type { DeckSlide } from '../../shared/roadtrip/deck';

interface SlideRailProps {
  slides: DeckSlide[];
  /** Index into `slides` of the one on the stage. */
  index: number;
  /** The deck's frame, so a cell has the shape of what it holds. */
  aspect: number;
  includeCta: boolean;
  /**
   * The slide as it will really go out — crop, caption, badge and grade —
   * drawn by `use-rail-thumbs`, or null until the first draw lands.
   */
  thumbFor: (slide: DeckSlide) => string | null;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: () => void;
  /** Indices into `post.slides`, content pictures only. */
  onMove: (from: number, to: number) => void;
  onIncludeCta: (on: boolean) => void;
  /** Where the closing card's words are written — the trip's own sheet. */
  onEditClosingCard: () => void;
}

/**
 * The deck, beside the picture instead of behind a tab.
 *
 * A carousel is the one thing about a piece you cannot see while you work on
 * it: the slide strip used to live on a Deck tab, so on any other tab the
 * piece looked like a single image. Here it sits next to the stage — a column
 * at every width, centred against the picture — and it is also where the deck
 * is BUILT: drag a picture to reorder, `+` to add one, `×` on the open
 * picture to drop it, and the closing card is a cell that turns itself on.
 *
 * A cell shows the COMPOSED slide, not the file behind it: the raw picture
 * cropped by CSS is a different picture the moment a slide is zoomed,
 * straightened or captioned, and a rail that disagrees with the stage is a
 * rail nobody trusts.
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
  thumbFor,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  onIncludeCta,
  onEditClosingCard,
}: SlideRailProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // One shape at every width: a column against the picture, never a row under
  // it. A row was the stacked fallback, and it costs the stage 91px of HEIGHT
  // on the screen with the least of it, while the width beside a portrait
  // frame is empty anyway — so the narrow shell now gets the same rail as the
  // wide one, only slimmer.
  //
  // The rail centres on the stage it belongs to, which is itself centred: a
  // short deck pinned to the top of a tall column reads as a strip that fell
  // off the picture. The centring is `safe`, so a deck longer than the column
  // still starts at the top instead of putting its first cells above the
  // scroller's reach.
  const box =
    'flex-none flex flex-col justify-center-safe gap-2 overflow-y-auto overflow-x-visible pr-1 w-[3.1rem] @min-[860px]:w-[4.6rem]';
  // A cell is sized on ONE axis and takes the other from its aspect ratio.
  const size = 'h-auto w-9 @min-[860px]:w-11';

  /**
   * The deck as the rail lays it out: the pictures, then the way to add
   * another, and the closing card LAST — either the card itself or the offer
   * of one. `+` used to come after the card, so the piece read as ending on
   * the button that adds a picture before it, and a carousel arrived with a
   * card it had never been asked for. Adding always inserts before the card
   * (the deck's own order); the rail now says so.
   */
  const pictures = slides.filter((s) => s.kind !== 'cta');
  const card = slides.find((s) => s.kind === 'cta') ?? null;

  const cell = (s: DeckSlide, i: number) => {
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
                className={`relative block ${size} overflow-hidden rounded-[5px] border bg-frame transition-colors ${
                  ci >= 0 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                } ${dragFrom === ci && ci >= 0 ? 'opacity-50 ' : ''}${
                  dropping
                    ? 'border-accent border-dashed'
                    : open
                      ? 'border-accent shadow-[0_0_0_2px_var(--color-accent-wash)]'
                      : 'border-line-strong hover:border-accent'
                }`}
              >
                <SlidePreview thumb={thumbFor(s)} kind={s.kind} />
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
              {/* The closing card comes off the same way a picture does. It
                  is added by choice, so it has to be droppable by choice —
                  a cell you can only turn on is the one-way door the cover
                  panel already had to be taught out of. */}
              {open && (ci >= 0 || s.kind === 'cta') && (
                <button
                  type="button"
                  onClick={s.kind === 'cta' ? () => onIncludeCta(false) : onRemove}
                  aria-label={
                    s.kind === 'cta'
                      ? 'Take the closing card off this piece'
                      : `Remove picture ${s.position} from this piece`
                  }
                  title={
                    s.kind === 'cta'
                      ? 'End this piece on its last picture instead'
                      : 'Remove this picture from the deck'
                  }
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
  };

  return (
    <div
      className={box}
      role="listbox"
      aria-label="The slides of this piece"
    >
      {/* The index a cell reports is its place in the DECK, never its place
          in the rail: the two differ by the card the rail draws last. */}
      {pictures.map((s) => cell(s, slides.indexOf(s)))}

      <div className="flex-none flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onAdd}
          title="Add the active picture to this deck"
          style={{ aspectRatio: String(aspect) }}
          className={`${size} grid place-items-center rounded-[5px] border border-dashed border-line-strong bg-paper text-[0.95rem] leading-none text-muted cursor-pointer hover:border-accent hover:text-accent-ink`}
        >
          +
        </button>
        <span className="font-mono text-[0.56rem] tracking-[0.08em] uppercase text-muted">
          Add
        </span>
      </div>

      {card ? (
        cell(card, slides.indexOf(card))
      ) : (
        <div className="flex-none flex flex-col items-center gap-1">
          {/* Asked for but empty: the trip's card has no words yet, so the
              deck has no last slide to draw. The offer then leads to where
              those words are written rather than repeating a click that
              has already been made. */}
          <button
            type="button"
            onClick={includeCta ? onEditClosingCard : () => onIncludeCta(true)}
            title={
              includeCta
                ? 'This piece ends on the trip’s closing card, and the card has no words yet — write them in ⚙ Trip'
                : 'Close this piece with the trip’s call to action'
            }
            style={{ aspectRatio: String(aspect) }}
            className={`${size} grid place-items-center rounded-[5px] border border-dashed border-line-strong bg-paper text-[0.95rem] leading-none text-faint cursor-pointer hover:border-accent hover:text-accent-ink`}
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
 * A cell's picture: the slide as it will be delivered, composed by
 * `use-rail-thumbs` through the one renderer the stage and the export use.
 *
 * Until the first draw lands — a decode after an edit settles — the cell says
 * what it holds rather than flashing a picture that is about to change. That
 * is also the whole of the old "a clip costs a decode per cell" objection:
 * every cell is drawn once per CHANGE now, never once per paint.
 */
function SlidePreview({ thumb, kind }: { thumb: string | null; kind: DeckSlide['kind'] }) {
  if (thumb) {
    return <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />;
  }
  return (
    <span className="absolute inset-0 grid place-items-center bg-paper-2 font-mono text-[0.5rem] leading-tight text-[#6b6459]">
      {kind === 'cta' ? 'card' : '·'}
    </span>
  );
}
