import { useEffect, useRef, useState } from 'react';
import { drawFramed, type Framing } from '../../../shared/media/framing';
import { cardLabel } from '../../../shared/media/motion-cards';
import { boundSource, loadBadgeSource, type BadgeSource } from '../../../shared/roadtrip/badge-render';
import { Icons } from '../../../shared/ui/icons';

/** The picture a card row draws its thumbnails from, and the frame each card sits in. */
export interface CardThumbSource {
  file: File;
  isVideo: boolean;
  /** Where a clip's frame is taken for the thumbnails. */
  videoSeconds: number;
  /** The frame's shape — a cell's, for a collage — in any consistent pixels. */
  dstW: number;
  dstH: number;
}

interface MotionCardsProps {
  /** The frames the view rests on, in order, the composition last (`readCards`). */
  cards: readonly Framing[];
  /** Where the view arrives on each, in the slide's seconds. */
  arrivals: readonly number[];
  /** How long it holds on each, as read back. */
  holdSeconds: number;
  /** The card the stage shows; null between two cards. */
  selected: number | null;
  thumb: CardThumbSource | null;
  onSelect: (index: number) => void;
  /** Give a still picture a Start: the ghost card before its composition. */
  onStart: () => void;
}

/** A card's height on screen; its width follows the frame's shape. */
const CARD_HEIGHT = 84;
/** The thumbnails' decode budget: a whole row is drawn from one small bitmap. */
const CARD_PIXELS = 500_000;

/**
 * The picture decoded ONCE for the whole row, within a small budget. A clip
 * is its element seeked to the frame asked for — the same loader the stage
 * and the rail use.
 *
 * The bitmap in hand is released ONE COMMIT AFTER it is replaced, or when
 * the row goes — never in the decode effect's own cleanup. Released there,
 * it was closed while the state still held it, and the paint effect of the
 * same commit (the piece moving on to its next slide brings new cards and a
 * new file at once) drew a closed `ImageBitmap`: "the image source is
 * detached", which took the whole tool down. The stage's own rule
 * (`studio.md`, «released one commit after»), met again here.
 */
function useCardPicture(thumb: CardThumbSource | null): { source: BadgeSource | null; seq: number } {
  const [state, setState] = useState<{ file: File | null; source: BadgeSource | null; seq: number }>({
    file: null,
    source: null,
    seq: 0,
  });
  const file = thumb?.file ?? null;
  const isVideo = thumb?.isVideo ?? false;
  const videoSeconds = thumb?.videoSeconds ?? 0;
  // What the state holds is released only once the state has let go of it.
  useEffect(() => {
    const held = state.source;
    return () => {
      if (held) held.release();
    };
  }, [state.source]);
  useEffect(() => {
    if (!file) {
      setState((s) => (s.source ? { file: null, source: null, seq: s.seq + 1 } : s));
      return;
    }
    let cancelled = false;
    void loadBadgeSource(file, isVideo ? videoSeconds : 0)
      .then(async (decoded) => {
        if (cancelled) {
          decoded.release();
          return;
        }
        const small = await boundSource(decoded, CARD_PIXELS);
        if (cancelled) {
          small.release();
          return;
        }
        setState((s) => ({ file, source: small, seq: s.seq + 1 }));
      })
      .catch(() => {
        // A picture the browser cannot draw leaves the cards dark; the stage
        // already says why, and a row must not say it a second time.
        if (!cancelled) setState((s) => (s.source ? { file: null, source: null, seq: s.seq + 1 } : s));
      });
    return () => {
      cancelled = true;
    };
  }, [file, isVideo, videoSeconds]);
  // Another file's picture is never drawn under this one's cards while the
  // new one decodes: the row stays dark for that moment rather than wrong.
  return { source: state.file === file ? state.source : null, seq: state.seq };
}

/** A bitmap already closed draws nothing rather than throwing — its width is 0 once detached. */
function drawable(source: BadgeSource): boolean {
  if (!(source.width > 0 && source.height > 0)) return false;
  const image = source.image;
  return !(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap && image.width === 0);
}

function seconds(v: number): string {
  return `${Math.max(0, v).toFixed(1)} s`;
}

/**
 * The row of cards: one thumbnail per frame the view rests on, the glide's
 * seconds on the arrow between two, a hold at a card's foot, the selected
 * card ringed. A tap picks a card — the stage then shows it and a gesture
 * there writes it (`PostEditor`). Drawn through `drawFramed`, the transform
 * every other surface draws a framing with, so a card is the frame as it will
 * really leave, only small and ungraded.
 */
export default function MotionCards({ cards, arrivals, holdSeconds, selected, thumb, onSelect, onStart }: MotionCardsProps) {
  const { source, seq } = useCardPicture(thumb);
  const aspect = thumb && thumb.dstH > 0 ? thumb.dstW / thumb.dstH : 9 / 16;
  const width = Math.round(Math.min(132, Math.max(40, CARD_HEIGHT * aspect)));
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const rowRef = useRef<HTMLDivElement>(null);

  // Paint every card from the one bitmap, at the device's density.
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cards.forEach((framing, i) => {
      const c = canvases.current[i];
      if (!c) return;
      const W = Math.round(width * dpr);
      const H = Math.round(CARD_HEIGHT * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, CARD_HEIGHT);
      if (source && drawable(source)) {
        drawFramed(ctx, source.image, source.width, source.height, width, CARD_HEIGHT, framing);
      }
    });
  }, [cards, source, seq, width]);

  // The picked card comes into view when the row is wider than the panel.
  useEffect(() => {
    if (selected === null) return;
    const el = canvases.current[selected]?.parentElement;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  const count = cards.length;
  const still = count <= 1;

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="The frames the picture rests on, in order"
      // The ring a picked card wears is drawn OUTSIDE its box, and a row that
      // scrolls clips whatever leaves it: the padding is the ring's room on
      // every side, or its top edge is cut (his report, 2026-09-24).
      className="flex items-start gap-0 overflow-x-auto overflow-y-hidden pt-1 pb-1 -mx-1 px-1 [scrollbar-width:thin]"
    >
      {still && (
        <>
          <button
            type="button"
            onClick={onStart}
            title="Give the picture a start a touch closer, and a move to its composition"
            className="flex-none flex flex-col items-center gap-1 p-0 border-0 bg-transparent cursor-pointer text-muted hover:text-ink"
          >
            <span
              className="grid place-items-center rounded-[6px] border border-dashed border-line-strong text-lg [&>svg]:w-5 [&>svg]:h-5"
              style={{ width, height: CARD_HEIGHT }}
            >
              {Icons.plus}
            </span>
            <span className="font-mono text-3xs tracking-[0.06em] uppercase">Start</span>
          </button>
          <Arrow label={undefined} />
        </>
      )}
      {cards.map((_, i) => {
        const on = i === selected;
        const label = cardLabel(i, count);
        const hold = !still && holdSeconds > 0 && i < count - 1 ? `hold ${seconds(holdSeconds)}` : '';
        const glide = i > 0 ? Math.max(0, (arrivals[i] ?? 0) - (arrivals[i - 1] ?? 0) - (holdSeconds > 0 ? holdSeconds : 0)) : 0;
        return (
          <span key={i} className="contents">
            {i > 0 && <Arrow label={seconds(glide)} />}
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(i)}
              title={`${label} — the stage shows it, a drag or a pinch writes it`}
              className="flex-none flex flex-col items-center gap-1 p-0 border-0 bg-transparent cursor-pointer"
            >
              <canvas
                ref={(el) => {
                  canvases.current[i] = el;
                }}
                aria-hidden="true"
                className={`block rounded-[6px] bg-frame ${on ? 'ring-2 ring-accent' : 'ring-1 ring-line-strong'}`}
                style={{ width, height: CARD_HEIGHT }}
              />
              <span className={`font-mono text-3xs tracking-[0.06em] uppercase ${on ? 'text-accent-ink' : 'text-muted'}`}>
                {label}
              </span>
              <span className="font-mono text-3xs text-ink-soft tabular-nums h-[1em] leading-none">{hold}</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** The arrow between two cards, with the glide's seconds under it. */
function Arrow({ label }: { label: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="flex-none w-8 flex flex-col items-center gap-0.5 text-muted [&>svg]:w-4 [&>svg]:h-4"
      style={{ paddingTop: CARD_HEIGHT / 2 - 8 }}
    >
      {Icons.chevronRight}
      <span className="font-mono text-3xs tabular-nums whitespace-nowrap">{label ?? ''}</span>
    </span>
  );
}
