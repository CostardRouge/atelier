/**
 * The deck and its transport as ONE band under the picture — «Aiguille», the
 * maintainer's pick from the 2026-09-14 design pass.
 *
 * The needle never moves: the piece slides under it. Every slide sits end to
 * end on one clock, a clip as wide as its cut and a still as wide as the
 * seconds its inspector gives it, and the slide under the needle IS the open
 * slide — dragging the band is scrubbing the piece and picking the slide in
 * one gesture, the thumb's own. ▶ plays the whole piece on the stage, slide
 * after slide, and LOOPS — over the piece, or over the open slide alone when
 * the loop pill (or `L`) says so (`use-deck-transport.ts`).
 *
 * It replaces three things that were stacked under (or beside) the picture:
 * the clip transport, the timeline of bars and, on a phone, the rail of
 * thumbnails — about 175px of height for what now takes one control row and
 * a 56px band. What they carried is still here: the cut of a clip opens the
 * Studio's own trim bar IN the band (✂), the speed is a pill on the row, and
 * the deck's verbs (move, remove, the closing card) sit behind ⋯ with `+`.
 * On a compact shell the row is 40px and every control on it a finger's
 * target (34px pills, `md` icon buttons, a 40px play), and the ticks toggle
 * moves into ⋯ — see `pillCompact` below.
 *
 * The open slide's cell carries a GRIP at each end: dragging one sets how long
 * the slide holds the screen — a still's seconds, a clip's cut — with the
 * other end held still on screen, and writes once, on release (the Content
 * tab's *On screen* slider is the same number, and its keyboard twin).
 *
 * The strip is laid out by `shared/roadtrip/deck-strip.ts`: a fixed number of
 * pixels a second with a floor, so a clip keeps its size wherever it sits and
 * a half-second slide is still something a finger lands on. The band claims
 * only the horizontal axis (`touch-pan-y`): a page that scrolls keeps its way
 * in on a touch screen (`frontend.md`).
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DeckSlide } from '../../shared/roadtrip/deck';
import {
  anchorOf,
  anchoredOffset,
  capacityMarks,
  localAtOffset,
  locate,
  resizedClip,
  resizedStill,
  snapToEdge,
  stepSlide,
  stripLayout,
  timeAtX,
  xAtTime,
  type LoopScope,
  type StripEdge,
} from '../../shared/roadtrip/deck-strip';
import { CLIP_SPEEDS, MAX_HOOK_SECONDS, MIN_HOOK_SECONDS, screenSecondsOf } from '../../shared/roadtrip/hook-video';
import TrimBar from '../../shared/media/TrimBar';
import type { TrimRange } from '../../shared/media/trim';
import { formatTimecode } from '../../shared/lib/format';
import IconButton from '../../shared/ui/IconButton';
import OverflowMenu, { type OverflowItem } from '../../shared/ui/OverflowMenu';
import { Icons } from '../../shared/ui/icons';
import { prefersReducedMotion } from '../../shared/ui/reduced-motion';
import RunMark from '../../shared/ui/RunMark';
import type { RunUnitState } from '../../shared/tasks/run-progress';
import { PRESS_LOOK } from '../../shared/ui/press';
import { useCoarsePointer } from '../../shared/ui/use-coarse-pointer';

/** The open slide's clip, when it is one. */
export interface StripClip {
  duration: number;
  range: TrimRange;
  /** In source seconds. */
  playhead: number;
  speed: number;
  onSpeed: (speed: number) => void;
  onRangeChange: (range: TrimRange) => void;
  onSeek: (sourceSeconds: number) => void;
  onScrubStart: () => void;
}

interface DeckStripProps {
  slides: DeckSlide[];
  /** How long each slide holds the screen, in the deck's order. */
  lengths: readonly number[];
  index: number;
  /** Where the piece is, in seconds. */
  time: number;
  playing: boolean;
  aspect: number;
  thumbFor: (slide: DeckSlide) => string | null;
  onTogglePlay: () => void;
  /** Go to a moment of the piece; the band calls it at most once a frame. */
  onScrub: (t: number) => void;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: () => void;
  /** Indices into `post.slides`, content pictures only. */
  onMove: (from: number, to: number) => void;
  includeCta: boolean;
  onIncludeCta: (on: boolean) => void;
  onEditClosingCard: () => void;
  clip: StripClip | null;
  /** What playback loops over — the whole piece or the open slide. */
  loopScope: LoopScope;
  onLoopScope: (scope: LoopScope) => void;
  /** The band shows the clip's trim bar instead of the deck. */
  trimming: boolean;
  onTrimming: (on: boolean) => void;
  /** The opener's ticks, when it has any to hear. */
  sound: { on: boolean; onToggle: () => void } | null;
  compact: boolean;
  /**
   * Where slide `i`'s pictures have frames placed, in that slide's seconds —
   * drawn as marks along its cell, so a slide that moves reads as one.
   */
  marksFor?: (i: number) => readonly number[];
  /**
   * The open still's length, when its cell's ends may set it: the bounds its
   * inspector gives, and the writer — told how far into the slide the needle
   * is left, so nothing jumps under it. A clip is resized through `clip`
   * (its cut) instead, and the closing card never.
   */
  resize?: { min: number; max: number; onChange: (seconds: number, local: number) => void } | null;
  /**
   * Slide `i`'s place in a running export, or null outside one — the band
   * becomes the run's queue (his pick V4, as Develop's filmstrip): a veil on
   * what waits, a ring and a measured fill on the slide in hand, ✓ or !.
   */
  runAt?: (i: number) => { state: RunUnitState; ratio: number | null } | null;
  /** An export is running: the deck's order is its, so nothing is added, removed or moved. */
  orderLocked?: boolean;
}

/** A resize in progress: the end held, where the other end stays, the draft. */
interface Sizing {
  edge: StripEdge;
  /** The fixed end's distance from the needle, px — read once, at the press. */
  anchor: number;
  seconds: number;
  /** A clip's draft cut. */
  range: TrimRange | null;
}

/** Shortest cut the handles may leave — the floor `clipSlice` keeps. */
const MIN_LENGTH = MIN_HOOK_SECONDS / 4;
const FRAME_STEP = 1 / 30;
const MIN_CELL_PX = 26;
const GAP_PX = 2;
/** A cell's height: the 56px band less its 1px border and the cell's 10px/6px
 *  insets. Its tiles are sized on it, so they keep the slide's aspect. */
const CELL_PX = 38;
const TAP_SLOP_PX = 5;
const SNAP_PX = 10;

const pillBase =
  'flex-none rounded-full border font-mono tracking-[0.04em] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
  // Pressed like every control of the suite (`PRESS_LOOK`, `shared/ui/press.ts`).
  `transition-[background-color,border-color,color,translate,box-shadow] duration-150 ease-paper ${PRESS_LOOK} data-pressed:bg-paper-2`;
/**
 * The pill's geometry: a caption's height beside a mouse, a finger's on a
 * phone — 34px, `Button`'s `md`, the height every pill of the page bar above
 * already wears. Two recipes rather than a second `h-*` appended to the
 * first: two utilities of one property resolve by Tailwind's order, not the
 * class list's (`frontend.md`). The text size is left to each pill, because
 * the speed `<select>` needs 16px on a phone (iOS zooms the page on focus
 * below that) while an icon-only pill needs none.
 */
const pillWide = 'h-7 px-2';
const pillCompact = 'h-[2.125rem] px-2.5';
const pillOff = 'border-line-strong bg-paper text-muted hover:text-accent-ink hover:border-accent';
const pillOn = 'border-accent bg-accent-wash text-accent-ink';

function seconds(v: number): string {
  return `${v.toFixed(1).replace(/\.0$/, '')}s`;
}

function slideName(slide: DeckSlide): string {
  return slide.kind === 'hook' ? 'Hook' : slide.kind === 'cta' ? 'Closing card' : `Picture ${slide.position}`;
}

export default function DeckStrip({
  slides,
  lengths,
  index,
  time,
  playing,
  aspect,
  thumbFor,
  onTogglePlay,
  onScrub,
  onSelect,
  onAdd,
  onRemove,
  onMove,
  includeCta,
  onIncludeCta,
  onEditClosingCard,
  clip,
  loopScope,
  onLoopScope,
  trimming,
  onTrimming,
  sound,
  compact,
  marksFor,
  resize,
  runAt,
  orderLocked = false,
}: DeckStripProps) {
  const coarse = useCoarsePointer();
  const pxPerSecond = compact ? 30 : 42;
  // While an end of the open cell is dragged, the band is drawn at the draft
  // length; the document hears about it once, on release.
  const [sizing, setSizing] = useState<Sizing | null>(null);
  const drawn = useMemo(
    () => (sizing ? lengths.map((l, i) => (i === index ? sizing.seconds : l)) : lengths),
    [lengths, sizing, index],
  );
  const layout = useMemo(() => stripLayout(drawn, pxPerSecond, MIN_CELL_PX, GAP_PX), [drawn, pxPerSecond]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // While a finger holds the band, it draws where the finger is, not where
  // the editor has caught up to — the editor hears about it once a frame.
  const [held, setHeld] = useState<number | null>(null);
  const shown = held ?? time;
  // Resizing, the strip keeps the cell's OTHER end where it was on screen.
  const offset = sizing ? anchoredOffset(layout, index, sizing.edge, sizing.anchor) : xAtTime(layout, shown);

  const viewport = useRef<HTMLDivElement>(null);
  const timeRef = useRef(time);
  timeRef.current = time;
  const scrubRaf = useRef(0);
  const scrubTo = useRef(0);
  const glide = useRef(0);
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const scrub = (t: number) => {
    scrubTo.current = t;
    if (scrubRaf.current) return;
    scrubRaf.current = requestAnimationFrame(() => {
      scrubRaf.current = 0;
      onScrubRef.current(scrubTo.current);
    });
  };
  const flush = (t: number) => {
    cancelAnimationFrame(scrubRaf.current);
    scrubRaf.current = 0;
    onScrubRef.current(t);
    setHeld(null);
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(scrubRaf.current);
      cancelAnimationFrame(glide.current);
    },
    [],
  );

  const drag = useRef<{
    x0: number;
    stripX: number;
    lastX: number;
    lastAt: number;
    velocity: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(glide.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      x0: e.clientX,
      stripX: xAtTime(layout, shown),
      lastX: e.clientX,
      lastAt: e.timeStamp,
      velocity: 0,
      moved: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < TAP_SLOP_PX) return;
    d.moved = true;
    const dt = e.timeStamp - d.lastAt;
    if (dt > 0) d.velocity = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX;
    d.lastAt = e.timeStamp;
    const t = timeAtX(layout, d.stripX - dx);
    setHeld(t);
    scrub(t);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (!d.moved) {
      // A tap opens the slide under the finger, on its start; a tap on the
      // open slide leaves the piece where it is.
      const box = e.currentTarget.getBoundingClientRect();
      const stripX = xAtTime(layout, shown) + (e.clientX - (box.left + box.width / 2));
      const under = locate(layout, timeAtX(layout, stripX)).index;
      if (under !== index) onSelect(under);
      return;
    }
    let x = d.stripX - (d.lastX - d.x0);
    // A finger that stopped before it lifted threw nothing.
    const stale = e.timeStamp - d.lastAt > 80;
    let v = stale || e.type === 'pointercancel' || prefersReducedMotion() ? 0 : d.velocity;
    const settle = () => flush(snapToEdge(layoutRef.current, timeAtX(layoutRef.current, x), SNAP_PX));
    if (Math.abs(v) < 0.08) {
      settle();
      return;
    }
    // A flick keeps going and slows down, then lands on a slide's edge when
    // it stops close enough to one.
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      x -= v * dt;
      v *= Math.pow(0.93, dt / 16);
      const l = layoutRef.current;
      if (x <= 0 || x >= l.width) {
        x = Math.max(0, Math.min(l.width, x));
        v = 0;
      }
      const t = timeAtX(l, x);
      setHeld(t);
      scrub(t);
      if (Math.abs(v) < 0.02) {
        settle();
        return;
      }
      glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  };

  // A horizontal wheel (a trackpad sweep, or Shift + wheel) moves the piece;
  // a vertical one is left to the page. Native, because React's is passive.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      e.preventDefault();
      cancelAnimationFrame(glide.current);
      const l = layoutRef.current;
      // From the moment still on its way to the editor, when there is one.
      const from = scrubRaf.current ? scrubTo.current : timeRef.current;
      scrub(timeAtX(l, xAtTime(l, from) + dx));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // The band remounts when the trim bar gives it back; `scrub` reads refs.
  }, [trimming]);

  // --- the open cell's ends ----------------------------------------------------
  const sizeDrag = useRef<{
    edge: StripEdge;
    x0: number;
    anchor: number;
    from: number;
    range: TrimRange | null;
    moved: boolean;
    draft: Sizing | null;
  } | null>(null);

  const onGripDown = (e: PointerEvent<HTMLSpanElement>, edge: StripEdge) => {
    if (e.button !== 0) return;
    // The grip is the band's too: without this the band would scrub as well.
    e.stopPropagation();
    cancelAnimationFrame(glide.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    sizeDrag.current = {
      edge,
      x0: e.clientX,
      anchor: anchorOf(layout, index, edge, offset),
      from: lengths[index] ?? 0,
      range: clip ? clip.range : null,
      moved: false,
      draft: null,
    };
  };

  const onGripMove = (e: PointerEvent<HTMLSpanElement>) => {
    const d = sizeDrag.current;
    if (!d) return;
    e.stopPropagation();
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < TAP_SLOP_PX) return;
    d.moved = true;
    let draft: Sizing | null = null;
    if (d.range && clip) {
      const range = resizedClip(d.range, d.edge, dx, pxPerSecond, clip.speed, clip.duration, MIN_LENGTH, MAX_HOOK_SECONDS, FRAME_STEP);
      draft = { edge: d.edge, anchor: d.anchor, seconds: screenSecondsOf(range, clip.speed), range };
    } else if (resize) {
      draft = { edge: d.edge, anchor: d.anchor, seconds: resizedStill(d.from, d.edge, dx, pxPerSecond, resize.min, resize.max), range: null };
    }
    d.draft = draft;
    setSizing(draft);
  };

  const onGripUp = (e: PointerEvent<HTMLSpanElement>) => {
    const d = sizeDrag.current;
    sizeDrag.current = null;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setSizing(null);
    // A tap on a grip changes nothing, and a gesture the browser took back
    // (pointercancel) is dropped rather than half-written.
    if (!d?.draft || e.type === 'pointercancel') return;
    const draft = d.draft;
    if (draft.range && clip) {
      // The cut's own writer: an in point moved puts the playhead on it, as
      // the trim bar's does.
      clip.onRangeChange(draft.range);
      return;
    }
    if (!resize) return;
    const next = stripLayout(
      lengths.map((l, i) => (i === index ? draft.seconds : l)),
      pxPerSecond,
      MIN_CELL_PX,
      GAP_PX,
    );
    resize.onChange(draft.seconds, localAtOffset(next, index, anchoredOffset(next, index, draft.edge, draft.anchor)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // A focused slider owns Space in the suite's key guard, so the band plays
    // the piece itself rather than going deaf to the transport key.
    if ((e.key === ' ' || e.code === 'Space') && !e.repeat) {
      e.preventDefault();
      onTogglePlay();
      return;
    }
    let t: number | null = null;
    if (e.key === 'ArrowRight') t = e.shiftKey ? time + 0.5 : stepSlide(layout, time, 1);
    else if (e.key === 'ArrowLeft') t = e.shiftKey ? time - 0.5 : stepSlide(layout, time, -1);
    else if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = layout.seconds;
    if (t === null) return;
    e.preventDefault();
    onScrub(Math.max(0, Math.min(layout.seconds, t)));
  };

  const slide = slides[index];
  const ci = slide?.kind === 'content' ? index - 1 : -1;
  const contentCount = slides.filter((s) => s.kind === 'content').length;
  const hasCard = slides.some((s) => s.kind === 'cta');

  // Whether the open cell wears its grips: never while the piece plays (the
  // strip moves under the finger), never on the closing card (its length is
  // the outro's), and on a clip only once its length is known.
  const grips =
    !playing &&
    !trimming &&
    slide?.kind !== 'cta' &&
    (clip ? clip.duration > 0 : Boolean(resize));
  // A finger's width on a phone, a pointer's beside a mouse.
  const gripPx = compact || coarse ? 16 : 10;

  // The row's geometry on this shell. On a phone every control is a finger's
  // target: the play button a size up from the 34px pills beside it (the same
  // step the 32/28 desktop pair makes), ⋯ and + at `md`. The row grows from
  // 32px to 40px for it, which the stage column pays.
  // The TARGETS follow the hand, the layout the width (C5 of
  // `docs/press-feedback.md`): a tablet held by a finger is a wide shell, so
  // it keeps the words beside the glyphs and takes the phone's 34px pills.
  const finger = compact || coarse;
  const pill = `${pillBase} ${finger ? pillCompact : pillWide}`;
  const iconSize = finger ? 'md' : 'sm';

  const lockedWhy = orderLocked ? 'Locked while exporting — the run follows the deck’s order' : undefined;
  const menu: OverflowItem[] = [];
  if (ci >= 0) {
    menu.push(
      { id: 'earlier', label: 'Move earlier', disabled: ci === 0 || orderLocked, title: lockedWhy, onSelect: () => onMove(ci, ci - 1) },
      { id: 'later', label: 'Move later', disabled: ci >= contentCount - 1 || orderLocked, title: lockedWhy, onSelect: () => onMove(ci, ci + 1) },
    );
  }
  // On a phone the ticks toggle lives here rather than on the row: a clip
  // hook already puts the speed and the cut on that row, and at 374px a
  // seventh control left the slide's name no room at all. The pill stays
  // where there is width for it.
  if (sound && compact) {
    menu.push({
      id: 'sound',
      label: sound.on ? 'Mute the opener’s ticks' : 'Hear the opener’s ticks',
      onSelect: sound.onToggle,
    });
  }
  if (!includeCta) {
    menu.push({ id: 'cta-on', label: 'Close with the call to action', disabled: orderLocked, title: lockedWhy, onSelect: () => onIncludeCta(true) });
  } else {
    menu.push({ id: 'cta-edit', label: hasCard ? 'Edit the closing card…' : 'Write the closing card…', onSelect: onEditClosingCard });
    menu.push({ id: 'cta-off', label: 'End on the last picture', disabled: orderLocked, title: lockedWhy, onSelect: () => onIncludeCta(false) });
  }
  if (ci >= 0) menu.push({ id: 'remove', label: 'Remove this picture', danger: true, disabled: orderLocked, title: lockedWhy, onSelect: onRemove });

  const slideLoop = loopScope === 'slide';
  const length = drawn[index] ?? 0;
  const cut = sizing?.range ?? clip?.range;
  const detail = !slide
    ? ''
    : clip && cut
      ? trimming
        ? `${formatTimecode(cut.start)} → ${formatTimecode(cut.end)} · ${seconds(screenSecondsOf(cut, clip.speed))} on screen${clip.speed !== 1 ? ' · no sound' : ''}`
        : `${seconds(length)} · from ${formatTimecode(cut.start)}${clip.speed !== 1 ? ` · ${clip.speed}× · no sound` : ''}`
      : slide.kind === 'cta'
        ? seconds(length)
        : `${seconds(length)} · ${slide.medium === 'video' ? 'video' : 'image'}`;

  return (
    <div className="w-full flex-none flex flex-col gap-1.5" aria-label="The piece">
      <div className={`flex items-center min-w-0 ${compact ? 'gap-1.5' : 'gap-2'}`}>
        <button
          type="button"
          onClick={onTogglePlay}
          className={`flex-none border-0 rounded-full bg-ink text-paper cursor-pointer inline-flex items-center justify-center hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-[background-color,translate,box-shadow] duration-150 ease-paper ${PRESS_LOOK} data-pressed:bg-accent ${
            finger ? 'w-10 h-10 [&>svg]:w-4 [&>svg]:h-4' : 'w-8 h-8 [&>svg]:w-3.5 [&>svg]:h-3.5'
          }`}
          aria-label={playing ? 'Pause' : trimming ? 'Play the cut' : slideLoop ? 'Play this slide' : 'Play the piece'}
          title={
            trimming
              ? 'Play the cut, looping (Space)'
              : slideLoop
                ? 'Play this slide, looping (Space)'
                : 'Play the whole piece, slide after slide, looping (Space)'
          }
        >
          {playing ? Icons.pause : Icons.play}
        </button>
        <span className="flex-none font-mono text-2xs tabular-nums text-muted">
          <span className="text-ink-soft">{formatTimecode(shown)}</span>
          {!compact && <> / {formatTimecode(layout.seconds)}</>}
        </span>
        <span className="flex-1 min-w-0 truncate text-xs text-ink" title={detail}>
          {slide ? slideName(slide) : ''}
          <span className="font-mono text-3xs text-muted"> · {detail}</span>
        </span>
        {/* What the loop runs over. Hidden while the cut is open: the cut loops
            its own stretch, whatever this says. */}
        {!trimming && (
          <button
            type="button"
            onClick={() => onLoopScope(slideLoop ? 'piece' : 'slide')}
            aria-pressed={slideLoop}
            aria-label={slideLoop ? 'Looping this slide — loop the whole piece' : 'Looping the whole piece — loop this slide'}
            className={`${pill} text-2xs inline-flex items-center gap-1 [&>svg]:w-3.5 [&>svg]:h-3.5 ${slideLoop ? pillOn : pillOff}`}
            title={slideLoop ? 'Looping this slide — click for the whole piece (L)' : 'Looping the whole piece — click for this slide only (L)'}
          >
            {slideLoop ? Icons.loopOne : Icons.loop}
            {!compact && <span>{slideLoop ? 'Slide' : 'Piece'}</span>}
          </button>
        )}
        {clip && (
          <select
            value={String(clip.speed)}
            onChange={(e) => clip.onSpeed(Number(e.target.value))}
            // On a phone: 16px (below that iOS zooms the page on focus and, on
            // a locked document, never zooms it back), a FIXED width and no
            // native arrow — a select sizes itself on its widest option, and
            // "0.25×" at 16px plus the arrow was a 94px pill that left the
            // slide's name 14px. A pill among pills, a tap opens the wheel.
            className={`${pillBase} ${
              compact
                ? 'h-[2.125rem] w-14 px-0 text-center text-base appearance-none'
                : `${pillWide} text-2xs pr-1`
            } ${clip.speed === 1 ? pillOff : pillOn}`}
            aria-label="Clip speed"
            title="The speed this slide plays at — on the stage and in the file. Other than 1× it goes out without sound"
          >
            {CLIP_SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        )}
        {clip && (
          <button
            type="button"
            onClick={() => onTrimming(!trimming)}
            aria-pressed={trimming}
            className={`${pill} text-2xs inline-flex items-center gap-1 [&>svg]:w-3.5 [&>svg]:h-3.5 ${trimming ? pillOn : pillOff}`}
            title={trimming ? 'Back to the piece' : 'Cut this clip: its in and out points (I · O at the playhead)'}
          >
            {trimming ? Icons.check : Icons.scissors}
            {!compact && <span>{trimming ? 'Done' : 'Cut'}</span>}
          </button>
        )}
        {sound && !compact && (
          <button
            type="button"
            onClick={sound.onToggle}
            aria-pressed={sound.on}
            aria-label={sound.on ? 'Mute the opener’s ticks' : 'Hear the opener’s ticks'}
            title={sound.on ? 'Mute the ticks (M)' : 'Hear the ticks (M)'}
            className={`${pillBase} ${finger ? 'h-[2.125rem] w-[2.125rem]' : `${pillWide} w-7`} text-2xs px-0 inline-flex items-center justify-center ${sound.on ? pillOn : pillOff}`}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none">
              <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
              {sound.on ? (
                <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              ) : (
                <path d="M10.5 6l3.5 4M14 6l-3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              )}
            </svg>
          </button>
        )}
        <OverflowMenu label={`More for ${slide ? slideName(slide) : 'this slide'}`} items={menu} side="above" size={iconSize} />
        <IconButton size={iconSize} variant="ghost" label="Add the active picture to this piece" title={lockedWhy ?? 'Add the active picture to this piece'} disabled={orderLocked} onClick={onAdd}>
          {Icons.plus}
        </IconButton>
      </div>

      {clip && trimming ? (
        <div className="h-14 flex items-center px-3 rounded-[10px] bg-paper-2 border border-line">
          <TrimBar
            duration={clip.duration}
            time={clip.playhead}
            range={clip.range}
            minLength={MIN_LENGTH}
            step={FRAME_STEP}
            onSeek={clip.onSeek}
            onScrubStart={clip.onScrubStart}
            onRangeChange={clip.onRangeChange}
          />
        </div>
      ) : (
        <div
          ref={viewport}
          role="slider"
          tabIndex={0}
          aria-label="The piece — drag to move through it"
          aria-valuemin={0}
          aria-valuemax={Math.round(layout.seconds * 10) / 10}
          aria-valuenow={Math.round(shown * 10) / 10}
          aria-valuetext={slide ? `${slideName(slide)}, ${formatTimecode(shown)} of ${formatTimecode(layout.seconds)}` : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="relative h-14 overflow-hidden rounded-[10px] bg-paper-2 border border-line touch-pan-y select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <div
            className="absolute top-2.5 bottom-1.5 left-1/2"
            style={{ width: layout.width, transform: `translateX(${-offset}px)` }}
          >
            {layout.cells.map((cell, i) => {
              const s = slides[i];
              if (!s) return null;
              const thumb = thumbFor(s);
              const video = s.medium === 'video';
              // Every cell repeats its picture along its length, so a long
              // still reads as the picture held rather than one tile and
              // paper. A clip's tiles are frames, split by dark rules; a
              // still's are the same picture again, split by paper. A still's
              // cell has a 1px dashed border, so its tile is sized on the
              // height inside it.
              const frame = Math.max(12, Math.round((video ? CELL_PX : CELL_PX - 2) * aspect));
              const rule = video ? 'rgba(0,0,0,0.55)' : 'var(--color-paper)';
              const holds = capacityMarks(s);
              const label =
                (s.kind === 'hook' ? 'Hook' : s.kind === 'cta' ? 'End' : String(s.position)) +
                (holds ? ` ${holds}` : '') +
                ` ${seconds(drawn[i] ?? 0)}` +
                (s.speed !== 1 ? ` · ${s.speed}×` : '');
              const gripped = grips && i === index;
              // Two grips never cover more than two thirds of a short cell.
              const grip = Math.min(gripPx, Math.floor(cell.width / 3));
              return (
                <div
                  key={s.slideId ?? s.kind}
                  className={`absolute top-0 bottom-0 rounded-[6px] overflow-hidden ${
                    video ? 'bg-frame' : 'bg-paper border border-dashed border-line-strong'
                  } ${i === index ? 'ring-2 ring-accent' : ''}`}
                  style={{
                    left: cell.left,
                    width: cell.width,
                    backgroundImage: thumb
                      ? `repeating-linear-gradient(90deg, ${rule} 0 1px, transparent 1px ${frame}px), url(${thumb})`
                      : undefined,
                    backgroundSize: thumb ? `auto, ${frame}px 100%` : undefined,
                    backgroundRepeat: thumb ? 'repeat, repeat-x' : undefined,
                  }}
                  aria-hidden="true"
                >
                  <span
                    className="absolute left-1 right-1 top-0.5 truncate font-mono text-3xs leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.85)]"
                    style={gripped ? { left: grip + 3, right: grip + 3 } : undefined}
                  >
                    {label}
                  </span>
                  {(marksFor?.(i) ?? []).map((at) => {
                    const length = lengths[i] ?? 0;
                    if (!(length > 0)) return null;
                    const x = Math.max(0, Math.min(1, at / length)) * cell.width;
                    return (
                      <span
                        key={at}
                        className="absolute bottom-0.5 w-1.5 h-1.5 -translate-x-1/2 rotate-45 bg-accent ring-1 ring-white/80"
                        style={{ left: Math.max(4, Math.min(cell.width - 4, x)) }}
                      />
                    );
                  })}
                  {slideLoop && i === index && (
                    <span
                      className="absolute right-0.5 bottom-0.5 grid place-items-center w-4 h-4 rounded-full bg-accent text-white [&>svg]:w-3 [&>svg]:h-3"
                      style={gripped ? { right: grip + 2 } : undefined}
                    >
                      {Icons.loopOne}
                    </span>
                  )}
                  {(() => {
                    const run = runAt?.(i);
                    return run ? <RunMark state={run.state} ratio={run.ratio} /> : null;
                  })()}
                  {gripped &&
                    (['start', 'end'] as const).map((edge) => (
                      <span
                        key={edge}
                        data-grip={edge}
                        onPointerDown={(e) => onGripDown(e, edge)}
                        onPointerMove={onGripMove}
                        onPointerUp={onGripUp}
                        onPointerCancel={onGripUp}
                        title={
                          s.medium === 'video' && clip
                            ? edge === 'start'
                              ? 'Drag to move where this clip starts'
                              : 'Drag to move where this clip ends'
                            : 'Drag to make this slide longer or shorter'
                        }
                        className={`absolute inset-y-0 grid place-items-center bg-accent cursor-ew-resize touch-pan-y ${
                          edge === 'start' ? 'left-0' : 'right-0'
                        }`}
                        style={{ width: grip }}
                      >
                        <span className="w-0.5 h-3.5 rounded-full bg-white/90" />
                      </span>
                    ))}
                </div>
              );
            })}
          </div>
          <div
            className="absolute inset-y-0 left-0 w-8 pointer-events-none"
            style={{ background: 'linear-gradient(90deg, var(--color-paper-2), transparent)' }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-y-0 right-0 w-8 pointer-events-none"
            style={{ background: 'linear-gradient(270deg, var(--color-paper-2), transparent)' }}
            aria-hidden="true"
          />
          {/* The needle: where the piece is, always in the middle. */}
          <div className="absolute left-1/2 top-1 bottom-0.5 w-0.5 -ml-px bg-ink pointer-events-none" aria-hidden="true">
            <span
              className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-solid border-transparent border-t-ink"
              style={{ borderWidth: '6px 5px 0 5px' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
