import { describe, expect, it } from 'vitest';
import { anchorOf, anchorTop } from './scroll-anchor';

const column = [
  { id: 'light', top: 120 },
  { id: 'tone', top: 400 },
  { id: 'colour', top: 700 },
];

describe('anchorOf', () => {
  it('names the last section starting at or above the view, and how far into it', () => {
    expect(anchorOf(450, column)).toEqual({ id: 'tone', offset: 50, top: 450 });
    expect(anchorOf(400, column)).toEqual({ id: 'tone', offset: 0, top: 400 });
  });

  it('names no section above the first one', () => {
    expect(anchorOf(30, column)).toEqual({ id: null, offset: 0, top: 30 });
  });
});

describe('anchorTop', () => {
  it('lands on the same section and offset in a column laid out otherwise', () => {
    // A RAW's column: a block above Tone pushes it 250 px down.
    const raw = [
      { id: 'light', top: 120 },
      { id: 'camera', top: 400 },
      { id: 'tone', top: 650 },
    ];
    expect(anchorTop(anchorOf(450, column), raw)).toBe(700);
  });

  it('falls back to the bare position where the section is missing, and never goes negative', () => {
    expect(anchorTop({ id: 'mixer', offset: 10, top: 333 }, column)).toBe(333);
    expect(anchorTop({ id: null, offset: 0, top: 30 }, column)).toBe(30);
    expect(anchorTop({ id: 'light', offset: -200, top: 0 }, column)).toBe(0);
  });
});
