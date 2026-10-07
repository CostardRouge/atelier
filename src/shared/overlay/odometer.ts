/**
 * Odometer digits — a numeral drawn in FIXED cells that ROLL (2026-10-07,
 * the trip recap's counter: «each in a fixed-width cell, so the badge never
 * shakes when 199 turns 200»).
 *
 * A text element whose `odometer` carries the continuous VALUE behind its
 * text is laid out one cell per character: every digit takes the widest
 * digit's advance, so a 1 holds the room of a 0 and the numeral never jitters
 * as it counts; a separator (the thin space of «1 317», a dash) keeps its own
 * advance. The text stays the formatted string every other reader knows — the
 * value only says how far each digit has rolled toward the next one.
 *
 * A digit rolls the way a car's does: the units rest for most of their unit
 * and roll over its last `ROLL_SHARE`; a higher digit rolls in the same
 * window only while every digit under it is a 9 — 199 → 200 rolls the three
 * together, 198 → 199 only the units. Rolling UP: the digit leaves by the
 * top, the next arrives from below.
 *
 * Pure and DOM-free; `draw-overlays.ts` measures and draws.
 */

/** The share of a unit the digits roll over — the rest they rest. */
export const ROLL_SHARE = 0.3;

export interface DigitCell {
  /** The character drawn. */
  ch: string;
  /** Left edge from the text's left, and the cell's width, in pixels. */
  x: number;
  w: number;
  /** The character is a digit, in a cell of the widest digit's width. */
  digit: boolean;
  /** How far this digit has rolled toward `next`, 0..1; 0 at rest. */
  roll: number;
  /** The digit arriving from below while rolling. */
  next: string;
}

const DIGIT = /^[0-9]$/;

/**
 * The cells of `text`, each character measured by `advance` — a digit at
 * `digitWidth`, the widest of the ten — laid left to right. `value` sets
 * each digit's roll; absent or not finite, nothing rolls.
 */
export function digitCells(
  text: string,
  advance: (ch: string) => number,
  digitWidth: number,
  value: number | null = null,
): DigitCell[] {
  const chars = [...text];
  const rolls = value !== null && Number.isFinite(value) ? digitRolls(value, chars.filter((c) => DIGIT.test(c)).length) : null;
  const cells: DigitCell[] = [];
  let x = 0;
  let digitIndex = 0;
  for (const ch of chars) {
    const digit = DIGIT.test(ch);
    const w = digit ? digitWidth : advance(ch);
    const roll = digit && rolls ? rolls[digitIndex] : 0;
    cells.push({ ch, x, w, digit, roll, next: digit ? String((Number(ch) + 1) % 10) : ch });
    if (digit) digitIndex += 1;
    x += w;
  }
  return cells;
}

/**
 * Each of `count` digits' roll toward its successor, left to right, for the
 * continuous `value` whose integer part those digits write: the units roll
 * over the last `ROLL_SHARE` of the unit, a higher digit along with them only
 * while every digit under it is a 9. A value at rest (a whole number) rolls
 * nothing.
 */
export function digitRolls(value: number, count: number): number[] {
  if (count <= 0) return [];
  const whole = Math.floor(value);
  const fraction = value - whole;
  const units = fraction <= 1 - ROLL_SHARE ? 0 : Math.min(1, (fraction - (1 - ROLL_SHARE)) / ROLL_SHARE);
  const out = new Array<number>(count).fill(0);
  if (units <= 0) return out;
  // From the units leftward: a digit rolls while the digits under it are all 9.
  let lowerAllNine = true;
  let rest = whole;
  for (let d = 0; d < count; d++) {
    const digit = rest % 10;
    out[count - 1 - d] = lowerAllNine ? units : 0;
    lowerAllNine = lowerAllNine && digit === 9;
    rest = Math.floor(rest / 10);
  }
  return out;
}

/** The sum of the cells' widths — the text's width in fixed cells. */
export function cellsWidth(cells: readonly DigitCell[]): number {
  return cells.reduce((sum, c) => sum + c.w, 0);
}
