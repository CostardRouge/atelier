import { describe, expect, it } from 'vitest';
import {
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
} from './slider-gesture';

const seconds = { min: 0.5, max: 60, step: 0.5 };
const unit = { min: 0, max: 1, step: 0.02 };
const exposure = { min: -5, max: 5, step: 0.01 };

describe('snapValue', () => {
  it('puts a value on the step grid, counted from the minimum', () => {
    expect(snapValue(25.7, seconds)).toBe(25.5);
    expect(snapValue(25.76, seconds)).toBe(26);
    expect(snapValue(0.61, unit)).toBe(0.62);
  });

  it('clamps to the bounds and never prints float noise', () => {
    expect(snapValue(-3, seconds)).toBe(0.5);
    expect(snapValue(99, seconds)).toBe(60);
    expect(snapValue(0.1 + 0.2, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapValue(Number.NaN, unit)).toBe(0);
  });
});

describe('valueAtPoint — a tap or a mouse press', () => {
  it('gives the minimum at the left edge and the maximum at the right', () => {
    expect(valueAtPoint(0, 300, seconds)).toBe(0.5);
    expect(valueAtPoint(300, 300, seconds)).toBe(60);
    expect(valueAtPoint(-20, 300, seconds)).toBe(0.5);
    expect(valueAtPoint(340, 300, seconds)).toBe(60);
  });

  it('gives the middle at the middle', () => {
    expect(valueAtPoint(150, 300, unit)).toBe(0.5);
    expect(valueAtPoint(150, 300, exposure)).toBe(0);
  });
});

describe('valueAfterDrag — a finger is relative', () => {
  it('moves by what the finger moved, wherever it landed', () => {
    // 60 px of a 300 px bar is a fifth of the range.
    expect(valueAfterDrag(0.5, 60, 300, unit)).toBe(0.7);
    expect(valueAfterDrag(0.5, -60, 300, unit)).toBe(0.3);
  });

  it('stops at the bounds', () => {
    expect(valueAfterDrag(0.9, 300, 300, unit)).toBe(1);
    expect(valueAfterDrag(0.1, -300, 300, unit)).toBe(0);
  });

  it('keeps the value on a bar with no width', () => {
    expect(valueAfterDrag(0.4, 50, 0, unit)).toBe(0.4);
  });
});

describe('intentOf', () => {
  it('waits until the finger has travelled the threshold', () => {
    expect(intentOf(3, 2)).toBe('pending');
    expect(intentOf(-5, 5)).toBe('pending');
  });

  it('calls a sideways move a drag and a vertical one a scroll', () => {
    expect(intentOf(8, 2)).toBe('drag');
    expect(intentOf(-9, 4)).toBe('drag');
    expect(intentOf(2, 9)).toBe('scroll');
    expect(intentOf(1, -12)).toBe('scroll');
  });

  it('gives a diagonal tie to the scroll', () => {
    expect(intentOf(8, 8)).toBe('scroll');
  });
});

describe('the fill', () => {
  it('starts at the reset value inside the range, else 0 on a bipolar range, else the minimum', () => {
    expect(originOf(exposure, 0)).toBe(0);
    expect(originOf(exposure)).toBe(0);
    expect(originOf(unit, 0.5)).toBe(0.5);
    expect(originOf(unit)).toBe(0);
    expect(originOf(seconds, 99)).toBe(0.5);
  });

  it('spans from the origin to the value, either side', () => {
    expect(fillSpan(-2.5, 0, exposure)).toEqual({ left: 0.25, width: 0.25 });
    expect(fillSpan(2.5, 0, exposure)).toEqual({ left: 0.5, width: 0.25 });
    expect(fillSpan(0.62, 0, unit)).toEqual({ left: 0, width: 0.62 });
    expect(fractionOf(1, { min: 1, max: 1, step: 0 })).toBe(0);
  });
});

describe('the typed value', () => {
  it('types a percentage stored as 0–1 in hundredths', () => {
    expect(typedScale('62%', unit)).toBe(100);
    expect(typedScale('50% →', unit)).toBe(100);
    expect(typedScale('25.7 s', seconds)).toBe(1);
    expect(typedScale('120%', { min: 0, max: 2, step: 0.01 })).toBe(1);
  });

  it('reads what a person types, commas and units included', () => {
    expect(parseTyped('25,5', 1, seconds)).toBe(25.5);
    expect(parseTyped('25.7 s', 1, seconds)).toBe(25.5);
    expect(parseTyped('62', 100, unit)).toBe(0.62);
    expect(parseTyped('−1.25 EV', 1, exposure)).toBe(-1.25);
    expect(parseTyped('abc', 1, unit)).toBeNull();
    expect(parseTyped('900', 1, seconds)).toBe(60);
  });

  it('writes the stored value in the typed unit, at the step’s precision', () => {
    expect(typedText(0.62, 100, unit)).toBe('62');
    expect(typedText(25.5, 1, seconds)).toBe('25.5');
    expect(typedText(-1.25, 1, exposure)).toBe('-1.25');
  });
});
