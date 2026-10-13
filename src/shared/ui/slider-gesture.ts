/**
 * The arithmetic of a slider BAR (`SliderBar.tsx`, `docs/slider-touch.md`,
 * face B — the maintainer's pick, 2026-10-13): the row IS the slider, and
 * a hand reads it in one of four ways.
 *
 * - A MOUSE places the value where it presses and drags it absolutely —
 *   the click a desktop has always had.
 * - A finger that lifts before `INTENT_PX` of travel is a TAP: the value
 *   goes where it landed, the ends included (his «si je clique au début ou
 *   à la fin, ça aurait dû me mettre au minimum ou au maximum»).
 * - A finger that travels sideways first is a DRAG, and a relative one: the
 *   value moves by what the finger moved, never jumps under it — the
 *   precision a 44 px band costs nothing for.
 * - A finger that travels vertically first is a SCROLL of the sheet, and the
 *   slider lets it go: scrolling a panel never changes a value.
 *
 * DOM-free and tested; the component only feeds it pixels.
 */

/** Travel, in CSS px, past which a finger has said what it is doing. */
export const INTENT_PX = 6;

/** How long a finger held still opens the typed value. */
export const HOLD_TO_TYPE_MS = 500;

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

/** A value put on the range's grid and inside its bounds. */
export function snapValue(value: number, { min, max, step }: SliderRange): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  const snapped = Math.round((clamped - min) / step) * step + min;
  // Float noise (0.1 + 0.2) would print as 0.30000000000000004 in a readout.
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 2));
  return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals))));
}

/** Where a value sits along the bar, 0 → 1. */
export function fractionOf(value: number, { min, max }: SliderRange): number {
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** The value under a point `x` px from the bar's left edge, on a bar `width` px wide. */
export function valueAtPoint(x: number, width: number, range: SliderRange): number {
  const f = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0;
  return snapValue(range.min + f * (range.max - range.min), range);
}

/** The value a relative drag reaches: where it started, plus what the finger moved. */
export function valueAfterDrag(start: number, dx: number, width: number, range: SliderRange): number {
  if (!(width > 0)) return snapValue(start, range);
  return snapValue(start + (dx / width) * (range.max - range.min), range);
}

export type Intent = 'pending' | 'drag' | 'scroll';

/**
 * What a finger is doing after moving `dx`, `dy` from where it landed: nothing
 * yet, a sideways drag, or a vertical scroll. A tie goes to the scroll — a
 * diagonal flick through a sheet is a person looking for something else.
 */
export function intentOf(dx: number, dy: number, threshold = INTENT_PX): Intent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < threshold && ay < threshold) return 'pending';
  return ax > ay ? 'drag' : 'scroll';
}

/**
 * Where the fill starts: the value the slider goes back to when it lies
 * inside the range (0 on a bipolar exposure, so −1 EV fills LEFT of the
 * middle), else the minimum.
 */
export function originOf(range: SliderRange, reset?: number): number {
  if (reset !== undefined && reset >= range.min && reset <= range.max) return reset;
  if (range.min < 0 && range.max > 0) return 0;
  return range.min;
}

/** The fill as a left edge and a width, both 0 → 1 of the bar. */
export function fillSpan(value: number, origin: number, range: SliderRange): { left: number; width: number } {
  const a = fractionOf(origin, range);
  const b = fractionOf(value, range);
  return { left: Math.min(a, b), width: Math.abs(b - a) };
}

/**
 * The factor between the stored value and the number a person TYPES: a
 * percentage stored as 0–1 is typed as 0–100. Read from the readout itself,
 * so a slider never needs to be told twice what unit it speaks.
 */
export function typedScale(printed: string, range: SliderRange): number {
  return printed.includes('%') && range.max <= 1 && range.min >= -1 ? 100 : 1;
}

/** A typed string read back into a stored value, or null when it says no number. */
export function parseTyped(text: string, scale: number, range: SliderRange): number | null {
  const match = text.replace(',', '.').match(/[-+−]?\d*\.?\d+(?:e[-+]?\d+)?/i);
  if (!match) return null;
  const n = Number(match[0].replace('−', '-'));
  if (!Number.isFinite(n)) return null;
  return snapValue(n / scale, range);
}

/** The number written in the typed field for a value — the stored value in the typed unit. */
export function typedText(value: number, scale: number, range: SliderRange): string {
  const shown = value * scale;
  const step = range.step * scale;
  const decimals = step > 0 ? Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 2;
  return Number(shown.toFixed(decimals)).toString();
}
