import { describe, expect, it } from 'vitest';
import { appHeightFor, type ViewportReading } from './app-height';

const reading = (layout: number, height?: number, scale = 1): ViewportReading => ({
  layout,
  visual: height === undefined ? null : { height, scale },
});

describe('appHeightFor', () => {
  it('takes the reading both viewports agree on', () => {
    expect(appHeightFor(reading(844, 844))).toBe(844);
  });

  it('trusts the visual viewport when the layout one is a toolbar short', () => {
    // Chrome on iOS after a reload with the toolbars retracted: the page is
    // laid out against the shorter viewport, the screen is 59px taller.
    expect(appHeightFor(reading(753, 812))).toBe(812);
  });

  it('ignores the keyboard, which only shrinks the visual viewport', () => {
    expect(appHeightFor(reading(844, 402))).toBe(844);
  });

  it('holds still while the page is pinched, in either direction', () => {
    expect(appHeightFor(reading(844, 402, 2.1))).toBeNull();
    expect(appHeightFor(reading(844, 1300, 0.65))).toBeNull();
  });

  it('tolerates the fractions a zoom of 1 is reported as', () => {
    expect(appHeightFor(reading(844, 843.5, 1.004))).toBe(844);
  });

  it('falls back to the layout viewport where there is no visual one', () => {
    expect(appHeightFor(reading(900))).toBe(900);
  });

  it('rounds to whole pixels', () => {
    expect(appHeightFor(reading(843.33, 843.33))).toBe(843);
  });

  it('trusts the fixed box when both viewports are stale-short (Safari 26)', () => {
    expect(appHeightFor({ layout: 739, visual: { height: 739, scale: 1 }, fixed: 799 })).toBe(799);
  });

  it('keeps the keyboard out through the fixed box too, which the keyboard does not move', () => {
    expect(appHeightFor({ layout: 844, visual: { height: 402, scale: 1 }, fixed: 844 })).toBe(844);
  });

  it('still freezes under a pinch whatever the fixed box says', () => {
    expect(appHeightFor({ layout: 844, visual: { height: 402, scale: 2 }, fixed: 900 })).toBeNull();
  });

  it('says nothing rather than zero when the readings are unusable', () => {
    expect(appHeightFor(reading(0, 0))).toBeNull();
    expect(appHeightFor(reading(Number.NaN))).toBeNull();
    // A backgrounded tab can report 0 for one of the two; the other still counts.
    expect(appHeightFor(reading(0, 812))).toBe(812);
  });
});
