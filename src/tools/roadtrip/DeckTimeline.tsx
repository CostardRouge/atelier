/**
 * The deck as a TIMELINE under the picture: one bar per slide, its width
 * the time it holds the screen, the hook first and the closing card last.
 *
 * The rail beside the picture (`SlideRail`) says what the deck IS; this says
 * how long each part of it LASTS, which a column of thumbnails never could —
 * the audit's Z5: the time of a piece had no representation anywhere, a
 * 0.5s slider apart. A clip slide's bar carries a handle on its right edge
 * that cuts the out point (the screen time, NLE semantics: the in point
 * stays) — the same number the trim bar above it writes, through the same
 * `onRangeChange` — and, while the clip plays, the playhead runs along it.
 *
 * Only the middle reorders, exactly as on the rail; the drag logic is the
 * rail's own. Wide screens only: on a phone the picture is the whole
 * screen's job and the rail keeps the deck (`PostEditor`).
 */

import { useRef, useState, type PointerEvent } from 'react';
import type { DeckSlide } from '../../shared/roadtrip/deck';
import { MIN_HOOK_SECONDS, screenSecondsCeiling } from '../../shared/roadtrip/hook-video';
import type { TrimRange } from '../../shared/media/trim';
import { Icons } from '../../shared/ui/icons';

export interface TimelineClip {
  /** The source's length. */
  duration: number;
  /** The stretch of the source the open slide delivers. */
  range: TrimRange;
  speed: number;
  /** The playhead, in source seconds. */
  playhead: number;
  playing: boolean;
  onRangeChange: (range: TrimRange) => void;
}

interface DeckTimelineProps {
  slides: DeckSlide[];
  index: number;
  aspect: number;
  includeCta: boolean;
  thumbFor: (slide: DeckSlide) => string | null;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: () => void;
  onMove: (from: number, to: number) => void;
  onIncludeCta: (on: boolean) => void;
  onEditClosingCard: () => void;
  /** The open slide's clip, when it is one. */
  clip: TimelineClip | null;
}

const BAR = 52;

function fmt(seconds: number): string {
  return `${seconds.toFixed(1).replace(/\.0$/, '')}s`;
}

export default function DeckTimeline({
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
  clip,
}: DeckTimelineProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const trim = useRef<{ originX: number; origin: TrimRange; width: number; seconds: number } | null>(null);

  const pictures = slides.filter((s) => s.kind !== 'cta');
  const card = slides.find((s) => s.kind === 'cta') ?? null;
  const total = slides.reduce((n, s) => n + (s.medium === 'video' ? s.seconds : 0), 0);
  const videos = slides.filter((s) => s.medium === 'video').length;

  const beginTrim = (e: PointerEvent<HTMLElement>, seconds: number) => {
    if (!clip || e.button !== 0) return;
    const bar = e.currentTarget.parentElement;
    if (!bar) return;
    trim.current = { originX: e.clientX, origin: clip.range, width: bar.getBoundingClientRect().width, seconds };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const moveTrim = (e: PointerEvent<HTMLElement>) => {
    const t = trim.current;
    if (!t || !clip) return;
    // The bar's width IS its screen time, so a pixel is a slice of it.
    const perPx = t.seconds / Math.max(1, t.width);
    const ceiling = screenSecondsCeiling(t.origin.start, clip.speed, clip.duration);
    const next = Math.max(MIN_HOOK_SECONDS, Math.min(ceiling, t.seconds + (e.clientX - t.originX) * perPx));
    clip.onRangeChange({ start: t.origin.start, end: t.origin.start + next * clip.speed });
  };
  const endTrim = (e: PointerEvent<HTMLElement>) => {
    if (!trim.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    trim.current = null;
  };

  const bar = (s: DeckSlide, i: number) => {
    const ci = s.kind === 'content' ? i - 1 : -1;
    const open = i === index;
    const dropping = ci >= 0 && dragOver === ci && dragFrom !== ci;
    const video = s.medium === 'video';
    const thumb = thumbFor(s);
    const progress =
      open && clip && video
        ? Math.max(0, Math.min(1, (clip.playhead - clip.range.start) / Math.max(0.001, clip.range.end - clip.range.start)))
        : null;
    const label = s.kind === 'hook' ? 'Hook' : s.kind === 'cta' ? 'Closing' : `Picture ${s.position}`;
    return (
      <div
        key={s.slideId ?? s.kind}
        className="relative flex-none min-w-0"
        style={{ flexGrow: video ? Math.max(1, s.seconds) : 0.9, flexBasis: video ? 0 : '6.5rem', height: BAR }}
      >
        <button
          type="button"
          onClick={() => onSelect(i)}
          role="option"
          aria-selected={open}
          title={`${label} — ${video ? `${fmt(s.seconds)} of video${s.speed !== 1 ? ` at ${s.speed}×` : ''}` : 'an image'}`}
          draggable={ci >= 0}
          onDragStart={(e) => {
            if (ci < 0) return;
            setDragFrom(ci);
            e.dataTransfer.effectAllowed = 'move';
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
          onKeyDown={(e) => {
            if (ci < 0 || e.altKey || e.metaKey || e.ctrlKey) return;
            const back = e.key === 'ArrowLeft';
            const on = e.key === 'ArrowRight';
            if (!back && !on) return;
            e.preventDefault();
            onMove(ci, back ? ci - 1 : ci + 1);
          }}
          className={`relative w-full h-full flex items-center gap-2 pl-1 pr-2 text-left rounded-[8px] border overflow-hidden transition-[box-shadow,border-color] ${
            ci >= 0 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
          } ${dragFrom === ci && ci >= 0 ? 'opacity-50 ' : ''}${
            video ? 'bg-paper-2 border-line-strong' : 'bg-paper border-dashed border-line-strong'
          } ${
            dropping
              ? 'border-accent border-dashed'
              : open
                ? 'border-accent shadow-[0_0_0_2px_var(--color-accent-wash)]'
                : 'hover:border-accent'
          }`}
        >
          <span
            className="flex-none h-[calc(100%-8px)] rounded-[4px] overflow-hidden bg-frame"
            style={{ aspectRatio: String(aspect) }}
            aria-hidden="true"
          >
            {thumb && <img src={thumb} alt="" className="block w-full h-full object-cover" />}
          </span>
          <span className="min-w-0 flex flex-col gap-0.5">
            <span className={`text-xs leading-tight truncate ${open ? 'text-accent-ink font-semibold' : 'text-ink'}`}>
              {label}
            </span>
            <span className="font-mono text-3xs text-muted tabular-nums whitespace-nowrap">
              {video ? `${fmt(s.seconds)}${s.speed !== 1 ? ` · ${s.speed}×` : ''}` : 'image'}
            </span>
          </span>
          {progress !== null && (
            <span
              className="absolute top-0 bottom-0 w-[2px] bg-ink pointer-events-none"
              style={{ left: `${progress * 100}%` }}
              aria-hidden="true"
            />
          )}
        </button>
        {/* The out point, on the open clip: the bar's right edge is the
            screen time, and dragging it cuts exactly what the trim bar's
            right handle cuts. */}
        {open && clip && video && (
          <button
            type="button"
            onPointerDown={(e) => beginTrim(e, s.seconds)}
            onPointerMove={moveTrim}
            onPointerUp={endTrim}
            onPointerCancel={endTrim}
            aria-label={`Out point of ${label}, ${fmt(s.seconds)} on screen — drag to cut`}
            title="Drag to change how long this slide stays on screen"
            className="absolute top-1 bottom-1 -right-[5px] w-[10px] rounded-full bg-accent cursor-ew-resize touch-pan-y select-none border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
        )}
        {open && (ci >= 0 || s.kind === 'cta') && (
          <button
            type="button"
            onClick={s.kind === 'cta' ? () => onIncludeCta(false) : onRemove}
            aria-label={s.kind === 'cta' ? 'Take the closing card off this piece' : `Remove ${label} from this piece`}
            title={s.kind === 'cta' ? 'End this piece on its last picture instead' : 'Remove this picture from the deck'}
            className="absolute -top-2 -right-2 w-5 h-5 grid place-items-center rounded-full border border-line-strong bg-paper text-muted cursor-pointer hover:border-accent hover:text-accent-ink [&>svg]:w-3 [&>svg]:h-3"
          >
            {Icons.close}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col gap-1.5" aria-label="The deck as a timeline">
      <div className="flex items-center gap-2 font-mono text-3xs tracking-[0.08em] uppercase text-muted">
        <span>Deck</span>
        <span className="flex-1" />
        {videos > 0 && (
          <span className="tabular-nums">
            {fmt(total)} of video · {slides.length} slide{slides.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-1.5" role="listbox" aria-label="The slides of this piece">
        {pictures.map((s) => bar(s, slides.indexOf(s)))}
        <button
          type="button"
          onClick={onAdd}
          title="Add the active picture to this deck"
          className="flex-none w-11 grid place-items-center rounded-[8px] border border-dashed border-line-strong bg-paper text-muted cursor-pointer hover:border-accent hover:text-accent-ink"
          style={{ height: BAR }}
        >
          {Icons.plus}
        </button>
        {card ? (
          bar(card, slides.indexOf(card))
        ) : (
          <button
            type="button"
            onClick={includeCta ? onEditClosingCard : () => onIncludeCta(true)}
            title={
              includeCta
                ? 'This piece ends on the trip’s closing card, and the card has no words yet — write them in ⚙ Trip'
                : 'Close this piece with the trip’s call to action'
            }
            className="flex-none w-20 flex flex-col items-center justify-center gap-0.5 rounded-[8px] border border-dashed border-line-strong bg-paper text-faint cursor-pointer hover:border-accent hover:text-accent-ink"
            style={{ height: BAR }}
          >
            {Icons.plus}
            <span className="font-mono text-3xs tracking-[0.08em] uppercase">Closing</span>
          </button>
        )}
      </div>
    </div>
  );
}
