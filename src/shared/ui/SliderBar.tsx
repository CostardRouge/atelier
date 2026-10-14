/**
 * The suite's ONE slider: the row IS the bar (face B of
 * `docs/slider-touch.md`, the maintainer's pick, 2026-10-13).
 *
 * A slider whose track shared the label's line with a pill and a verb was
 * 35 px of travel on a phone, grabbed on 16 px — *«ridicule, on ne peut pas
 * s'en servir»*. The bar takes the panel's whole width, is 36 px tall under a
 * mouse and 44 px under a finger, writes its name at the left and its value
 * at the right, and FILLS from where it goes back to (0 on a bipolar range)
 * to the value, with an accent edge where the value is.
 *
 * The hand is read by `slider-gesture.ts`: a mouse places and drags
 * absolutely; a finger's TAP places the value where it landed, its sideways
 * DRAG is relative, its vertical move is the sheet's scroll. Holding still
 * (or Enter on the keyboard) opens the value as a field to type into; a
 * double-click, or the ↺ that shows once the value departs, puts it back.
 *
 * A native `<input type="range">` stays INSIDE, transparent and
 * pointer-less, so the keyboard, a screen reader, the undo keys' "textless
 * input" rule and Space's focus rule all keep answering exactly as they did.
 *
 * Its focus ring is drawn INSIDE the bar, and only for the keyboard
 * (2026-10-14, his screenshot): an outer ring was cut off by the section's
 * edge, and the press's own focus lit it on every drag.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Icons } from './icons';
import {
  HOLD_TO_TYPE_MS,
  fillSpan,
  fractionOf,
  intentOf,
  originOf,
  parseTyped,
  snapValue,
  typedScale,
  typedText,
  valueAfterDrag,
  valueAtPoint,
  type SliderRange,
} from './slider-gesture';

export interface SliderBarProps {
  /** The name drawn inside the bar, at its left. */
  label: ReactNode;
  /** The accessible name, when `label` is not plain text or says less than the setting. */
  name?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** How the value reads at the bar's right. */
  format?: (value: number) => string;
  /** The value already written as words — wins over `format`. */
  printed?: string;
  disabled?: boolean;
  /**
   * Where a double-click and the ↺ put it back. Given, the bar also marks a
   * departed value with a dot and fills from it when it lies in the range.
   */
  reset?: number;
  /** Where the fill starts, when it is not `reset` (or 0 on a bipolar range). */
  origin?: number;
  /** Drawn before the name — a band's hue swatch. */
  lead?: ReactNode;
  /** Drawn after the name, and pressable — an ⓘ. */
  after?: ReactNode;
}

type Gesture =
  | { kind: 'mouse'; id: number }
  | { kind: 'pending'; id: number; x: number; y: number; timer: number }
  | { kind: 'drag'; id: number; x: number; start: number };

/** Presses on these never reach the bar: the ↺, an ⓘ, the typed field. */
const stop = (e: PointerEvent) => e.stopPropagation();

export default function SliderBar({
  label,
  name,
  value,
  min,
  max,
  step,
  onChange,
  format,
  printed,
  disabled = false,
  reset,
  origin,
  lead,
  after,
}: SliderBarProps) {
  const range: SliderRange = { min, max, step };
  const shown = Math.min(max, Math.max(min, value));
  const words = printed ?? (format ? format(value) : String(value));
  const departed = reset !== undefined && Math.abs(value - reset) > step / 2;
  const fill = fillSpan(shown, origin ?? originOf(range, reset), range);
  const edge = fractionOf(shown, range);

  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  // The handlers read the value through a ref: a drag's pointermoves arrive
  // faster than the parent re-renders, and a stale `value` would make every
  // move write the same number twice.
  const live = useRef({ value, range, onChange });
  live.current = { value, range, onChange };
  const [typing, setTyping] = useState<string | null>(null);
  // A typed value ends ONCE: Enter or Escape gives the focus back to the bar,
  // and the field's own blur would otherwise commit it a second time —
  // Escape's "keep what was there" included.
  const typedOpen = useRef(false);
  const [dragging, setDragging] = useState(false);
  // The keyboard's focus, drawn as a ring INSIDE the bar. Never the press's:
  // a press focuses the hidden input from script, after a `pointerdown` whose
  // mouse events were cancelled, and Chrome counts that as `:focus-visible`.
  const [ring, setRing] = useState(false);
  const pressed = useRef(false);
  const scale = typedScale(words, range);

  useEffect(
    () => () => {
      const g = gesture.current;
      if (g?.kind === 'pending') window.clearTimeout(g.timer);
    },
    [],
  );

  const write = (next: number) => {
    const { value: now, range: r, onChange: send } = live.current;
    const snapped = snapValue(next, r);
    if (snapped !== now) send(snapped);
  };

  const pointAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    return rect ? valueAtPoint(clientX - rect.left, rect.width, live.current.range) : live.current.value;
  };

  const startTyping = () => {
    gesture.current = null;
    setDragging(false);
    typedOpen.current = true;
    setTyping(typedText(live.current.value, scale, live.current.range));
  };

  const endGesture = () => {
    const g = gesture.current;
    if (g?.kind === 'pending') window.clearTimeout(g.timer);
    gesture.current = null;
    setDragging(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || typing !== null || e.button !== 0) return;
    // No compatibility mouse events after a finger: the `mousedown` a touch
    // ends with would take the focus back from a value being typed. A
    // finger's SCROLL is not touched by this — `touch-action` decides that.
    e.preventDefault();
    // Focus the hidden input the way a native range is focused by a press,
    // so the arrows answer next — without scrolling a frame (`frontend.md`).
    pressed.current = true;
    setRing(false);
    inputRef.current?.focus({ preventScroll: true });
    if (e.pointerType === 'mouse') {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'mouse', id: e.pointerId };
      setDragging(true);
      write(pointAt(e.clientX));
      return;
    }
    const timer = window.setTimeout(() => {
      if (gesture.current?.kind === 'pending') startTyping();
    }, HOLD_TO_TYPE_MS);
    gesture.current = { kind: 'pending', id: e.pointerId, x: e.clientX, y: e.clientY, timer };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.kind === 'mouse') {
      write(pointAt(e.clientX));
      return;
    }
    if (g.kind === 'pending') {
      const intent = intentOf(e.clientX - g.x, e.clientY - g.y);
      if (intent === 'pending') return;
      window.clearTimeout(g.timer);
      if (intent === 'scroll') {
        gesture.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'drag', id: e.pointerId, x: e.clientX, start: live.current.value };
      setDragging(true);
      return;
    }
    const width = barRef.current?.getBoundingClientRect().width ?? 0;
    write(valueAfterDrag(g.start, e.clientX - g.x, width, live.current.range));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.kind === 'pending') write(pointAt(e.clientX));
    endGesture();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      startTyping();
      return;
    }
    if (!e.shiftKey) return;
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    write(live.current.value + dir * step * 10);
  };

  const commitTyped = (text: string | null) => {
    if (!typedOpen.current) return;
    typedOpen.current = false;
    if (text !== null) {
      const next = parseTyped(text, scale, live.current.range);
      if (next !== null) write(next);
    }
    setTyping(null);
    inputRef.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={barRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endGesture}
      onDoubleClick={() => reset !== undefined && !disabled && write(reset)}
      onContextMenu={(e) => e.preventDefault()}
      data-dragging={dragging || undefined}
      aria-disabled={disabled || undefined}
      data-ring={ring || undefined}
      className={`group/slider relative w-full min-w-0 h-9 pointer-coarse:h-11 overflow-hidden rounded-control border bg-surface select-none touch-pan-y [-webkit-touch-callout:none] transition-colors ${
        disabled
          ? 'opacity-45 pointer-events-none border-line-strong'
          : 'cursor-ew-resize border-line-strong hover:border-ink-soft/40 data-[ring]:border-accent data-[dragging]:border-accent'
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 bg-accent-wash"
        style={{ left: `${fill.left * 100}%`, width: `${fill.width * 100}%` }}
      />
      {/* The value's edge, open across the band the words are written in:
          drawn whole, it ran through the value at one end of the range and
          through the name and its ↺ near the middle. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 w-0.5 bg-[linear-gradient(to_bottom,var(--color-accent)_0_27%,transparent_27%_73%,var(--color-accent)_73%)]"
        style={{ left: `clamp(0px, calc(${edge * 100}% - 1px), calc(100% - 2px))` }}
      />
      {/* The one raw range the lint allows: it is the bar's keyboard and its
          screen-reader half, never seen and never pointed at. */}
      <input
        ref={inputRef}
        // eslint-disable-next-line no-restricted-syntax
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        tabIndex={typing !== null ? -1 : undefined}
        aria-label={name ?? (typeof label === 'string' ? label : undefined)}
        aria-valuetext={words}
        onChange={(e) => write(Number(e.target.value))}
        onKeyDown={onKeyDown}
        onFocus={() => setRing(!pressed.current)}
        onBlur={() => {
          pressed.current = false;
          setRing(false);
        }}
        className="absolute inset-0 w-full h-full m-0 opacity-0 pointer-events-none"
      />
      <span className="relative flex items-center h-full gap-1.5 pl-3 pr-2.5 pointer-events-none">
        {/* In the bar's own left padding, so every name starts at the same x
            whether or not its row can depart from a default. */}
        {departed && <span aria-hidden="true" className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent" />}
        {lead}
        <span className={`min-w-0 truncate text-sm leading-none ${departed ? 'text-ink font-medium' : 'text-ink-soft'}`}>{label}</span>
        {(after || (departed && reset !== undefined)) && (
          <span className="flex-none inline-flex items-center gap-1 pointer-events-auto" onPointerDown={stop} onDoubleClick={(e) => e.stopPropagation()}>
            {after}
            {departed && reset !== undefined && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => write(reset)}
                aria-label={`Reset ${name ?? (typeof label === 'string' ? label : 'this setting')}`}
                title="Reset"
                className="relative inline-grid place-items-center w-5 h-5 rounded-[6px] text-accent-ink cursor-pointer after:absolute after:-inset-1.5 after:content-[''] hover:bg-accent-wash [&>svg]:w-3.5 [&>svg]:h-3.5"
              >
                {Icons.reset}
              </button>
            )}
          </span>
        )}
        <span className="flex-1" />
        {typing !== null ? (
          <input
            // Focused once, selected so the first keystroke replaces it, and
            // never scrolled into view (`shared/ui/focus.ts`).
            ref={(el) => {
              if (el && document.activeElement !== el) {
                el.focus({ preventScroll: true });
                el.select();
              }
            }}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            value={typing}
            aria-label={`Type ${name ?? (typeof label === 'string' ? label : 'the value')}`}
            onPointerDown={stop}
            onChange={(e) => setTyping(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTyped(typing);
              else if (e.key === 'Escape') {
                e.stopPropagation();
                commitTyped(null);
              }
            }}
            onBlur={() => commitTyped(typing)}
            className="pointer-events-auto w-[5.5rem] h-7 px-2 text-right font-mono text-xs tabular-nums bg-paper text-ink border border-accent rounded-[8px] focus:outline-none"
          />
        ) : (
          <span className={`flex-none whitespace-nowrap font-mono text-xs tabular-nums ${departed || reset === undefined ? 'text-ink' : 'text-muted'}`}>
            {words}
          </span>
        )}
      </span>
      {ring && <span aria-hidden="true" className="absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-accent/35 pointer-events-none" />}
    </div>
  );
}
