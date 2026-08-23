import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BADGE_LAYOUT,
  badgeElements,
  heightFractionOf,
  type BadgeLayout,
} from './badge-layout';
import type { BadgeContent } from './day-badge';

const full: BadgeContent = {
  kicker: 'Australie',
  label: 'Jour',
  headline: '27',
  counter: 'sur 310',
  caption: 'Kalbarri',
};

const REEL = 9 / 16;
const SQUARE = 1;
const LANDSCAPE = 16 / 9;

const layout = (over: Partial<BadgeLayout> = {}): BadgeLayout => ({
  ...DEFAULT_BADGE_LAYOUT,
  ...over,
});

describe('heightFractionOf', () => {
  it('is the size itself on a landscape frame, where the short side IS the height', () => {
    expect(heightFractionOf(0.17, LANDSCAPE)).toBeCloseTo(0.17, 6);
    expect(heightFractionOf(0.17, SQUARE)).toBeCloseTo(0.17, 6);
  });

  it('shrinks against height on a portrait frame, where the short side is the width', () => {
    expect(heightFractionOf(0.17, REEL)).toBeCloseTo(0.17 * (9 / 16), 6);
  });
});

describe('badgeElements', () => {
  it('emits one text element per piece, in reading order', () => {
    const els = badgeElements(full, layout(), REEL);
    expect(els).toHaveLength(5);
    expect(els.every((e) => e.kind === 'text')).toBe(true);
    expect(els.map((e) => e.text)).toEqual([
      'Australie',
      'Jour',
      '27',
      'sur 310',
      'Kalbarri',
    ]);
  });

  it('makes the numeral the biggest piece by a wide margin', () => {
    const els = badgeElements(full, layout(), REEL);
    const headline = els.find((e) => e.text === '27')!;
    const others = els.filter((e) => e.text !== '27');
    for (const el of others) {
      expect(el.sizeFrac).toBeLessThan(headline.sizeFrac / 3);
    }
  });

  it('sizes the headline exactly as asked', () => {
    const els = badgeElements(full, layout({ sizeFrac: 0.2 }), REEL);
    expect(els.find((e) => e.text === '27')!.sizeFrac).toBeCloseTo(0.2, 6);
  });

  it('stacks downward without overlapping', () => {
    const els = badgeElements(full, layout({ anchor: 'top-left', y: 0.1 }), REEL);
    for (let i = 1; i < els.length; i++) {
      expect(els[i].y).toBeGreaterThan(els[i - 1].y);
    }
    expect(els[0].y).toBeCloseTo(0.1, 6);
  });

  it('skips absent pieces entirely rather than reserving their space', () => {
    const bare: BadgeContent = {
      kicker: null,
      label: null,
      headline: '27',
      counter: null,
      caption: null,
    };
    const els = badgeElements(bare, layout(), REEL);
    expect(els).toHaveLength(1);
    expect(els[0].text).toBe('27');
  });

  it('hangs the block above a bottom anchor, so it never runs off the frame', () => {
    const els = badgeElements(full, layout({ anchor: 'bottom-left', y: 0.9 }), REEL);
    const last = els[els.length - 1];
    // The final line's own height still has to fit under it, but the block's
    // foot lands at the anchor rather than starting there.
    expect(last.y).toBeLessThan(0.9);
    expect(els[0].y).toBeLessThan(last.y);
  });

  it('centres the block around a centre anchor', () => {
    const top = badgeElements(full, layout({ anchor: 'top-center', y: 0.5 }), REEL);
    const mid = badgeElements(full, layout({ anchor: 'center', y: 0.5 }), REEL);
    const bottom = badgeElements(full, layout({ anchor: 'bottom-center', y: 0.5 }), REEL);
    expect(mid[0].y).toBeLessThan(top[0].y);
    expect(bottom[0].y).toBeLessThan(mid[0].y);
    // Centre sits exactly halfway between the two extremes.
    expect(mid[0].y).toBeCloseTo((top[0].y + bottom[0].y) / 2, 6);
  });

  it('gives every line the anchor’s horizontal side', () => {
    for (const [anchor, side] of [
      ['bottom-left', 'top-left'],
      ['bottom-right', 'top-right'],
      ['center', 'top-center'],
    ] as const) {
      const els = badgeElements(full, layout({ anchor }), REEL);
      expect(els.every((e) => e.anchor === side)).toBe(true);
    }
  });

  it('keeps the same x for every line', () => {
    const els = badgeElements(full, layout({ x: 0.07 }), REEL);
    expect(els.every((e) => e.y >= 0 && e.x === 0.07)).toBe(true);
  });

  it('spaces a portrait frame more tightly in y than a landscape one', () => {
    // Same request, different frames: the sizes are equal (both are fractions
    // of the short side) but the portrait stack covers less of the height.
    const reel = badgeElements(full, layout({ anchor: 'top-left', y: 0 }), REEL);
    const wide = badgeElements(full, layout({ anchor: 'top-left', y: 0 }), LANDSCAPE);
    expect(reel.map((e) => e.sizeFrac)).toEqual(wide.map((e) => e.sizeFrac));
    const reelSpan = reel[reel.length - 1].y;
    const wideSpan = wide[wide.length - 1].y;
    expect(reelSpan).toBeLessThan(wideSpan);
    expect(reelSpan).toBeCloseTo(wideSpan * (9 / 16), 6);
  });

  it('leaves every element fully themed', () => {
    const els = badgeElements(full, layout(), REEL);
    expect(els.every((e) => e.styleOverrides?.length === 0)).toBe(true);
  });

  it('gives each element a distinct id', () => {
    const els = badgeElements(full, layout(), REEL);
    expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
  });
});
