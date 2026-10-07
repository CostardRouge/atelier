import { describe, expect, it } from 'vitest';
import { ROLL_SHARE, cellsWidth, digitCells, digitRolls } from './odometer';

/** A fake face: a 1 is narrow, a 0 wide, a space narrower still. */
const advance = (ch: string) => (ch === '1' ? 6 : ch === ' ' ? 4 : 10);

describe('the digits in fixed cells', () => {
  it('gives every digit the widest digit’s width, and a separator its own', () => {
    const cells = digitCells('1 317', advance, 10);
    expect(cells.map((c) => c.w)).toEqual([10, 4, 10, 10, 10]);
    expect(cells.map((c) => c.digit)).toEqual([true, false, true, true, true]);
    expect(cells.map((c) => c.x)).toEqual([0, 10, 14, 24, 34]);
    expect(cellsWidth(cells)).toBe(44);
  });

  it('keeps the text’s width whatever the digits: 199 and 200 take the same room', () => {
    expect(cellsWidth(digitCells('199', advance, 10))).toBe(cellsWidth(digitCells('200', advance, 10)));
    expect(cellsWidth(digitCells('111', advance, 10))).toBe(30);
  });

  it('rolls nothing without a value, and names each digit’s successor', () => {
    const cells = digitCells('19', advance, 10);
    expect(cells.map((c) => c.roll)).toEqual([0, 0]);
    expect(cells.map((c) => c.next)).toEqual(['2', '0']);
  });

  it('rolls the units over the last share of the unit, resting before', () => {
    expect(digitRolls(198.0, 3)).toEqual([0, 0, 0]);
    expect(digitRolls(198.5, 3)).toEqual([0, 0, 0]);
    expect(digitRolls(198.7, 3)[2]).toBeCloseTo(0, 9);
    expect(digitRolls(198.85, 3)[2]).toBeCloseTo(0.5, 9);
    expect(digitRolls(198.999, 3)[2]).toBeCloseTo((0.999 - (1 - ROLL_SHARE)) / ROLL_SHARE, 6);
    const [a, b, c] = digitRolls(198.85, 3);
    expect([a, b]).toEqual([0, 0]);
    expect(c).toBeCloseTo(0.5, 9);
  });

  it('rolls a higher digit along only while every digit under it is a 9', () => {
    const near = (rolls: number[], want: number[]) => rolls.forEach((r, i) => expect(r).toBeCloseTo(want[i], 9));
    near(digitRolls(199.85, 3), [0.5, 0.5, 0.5]);
    near(digitRolls(189.85, 3), [0, 0.5, 0.5]);
    near(digitRolls(9.85, 1), [0.5]);
    near(digitRolls(1009.85, 4), [0, 0, 0.5, 0.5]);
  });

  it('reads the value through the cells, skipping the separators', () => {
    const cells = digitCells('1 999', advance, 10, 1999.85);
    cells.map((c) => c.roll).forEach((r, i) => expect(r).toBeCloseTo([0.5, 0, 0.5, 0.5, 0.5][i], 9));
    expect(digitCells('1 999', advance, 10, Number.NaN).every((c) => c.roll === 0)).toBe(true);
  });
});
