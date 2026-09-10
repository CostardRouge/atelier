import { describe, expect, it } from 'vitest';
import {
  atLeast,
  COMPACT_MAX,
  COMPACT_QUERY,
  LAYOUT_MODES,
  MEDIUM_MAX,
  MEDIUM_QUERY,
  modeForMatches,
  modeForWidth,
} from './layout-mode';

describe('modeForWidth', () => {
  it('names the three modes at the widths that matter', () => {
    // The devices the suite's responsive work has actually been measured on.
    expect(modeForWidth(390)).toBe('compact'); // iPhone portrait
    expect(modeForWidth(744)).toBe('compact'); // iPad mini portrait
    expect(modeForWidth(834)).toBe('medium'); // iPad portrait
    expect(modeForWidth(1024)).toBe('medium'); // iPad landscape
    expect(modeForWidth(1280)).toBe('expanded');
    expect(modeForWidth(1920)).toBe('expanded');
  });

  it('switches exactly on the boundaries, bottom-exclusive', () => {
    expect(modeForWidth(COMPACT_MAX - 1)).toBe('compact');
    expect(modeForWidth(COMPACT_MAX)).toBe('medium');
    expect(modeForWidth(MEDIUM_MAX - 1)).toBe('medium');
    expect(modeForWidth(MEDIUM_MAX)).toBe('expanded');
  });

  it('reads a width nothing could measure as the safest mode', () => {
    // A zero-width or not-yet-measured viewport must not claim it has room
    // for three docked columns: compact is the one that fits anywhere.
    expect(modeForWidth(0)).toBe('compact');
    expect(modeForWidth(Number.NaN)).toBe('compact');
    expect(modeForWidth(-100)).toBe('compact');
  });
});

describe('atLeast', () => {
  it('orders the modes narrowest to widest', () => {
    expect(atLeast('compact', 'compact')).toBe(true);
    expect(atLeast('compact', 'medium')).toBe(false);
    expect(atLeast('medium', 'medium')).toBe(true);
    expect(atLeast('medium', 'expanded')).toBe(false);
    expect(atLeast('expanded', 'compact')).toBe(true);
    expect(atLeast('expanded', 'expanded')).toBe(true);
  });

  it('agrees with the declared order', () => {
    expect(LAYOUT_MODES).toEqual(['compact', 'medium', 'expanded']);
  });
});

describe('modeForMatches', () => {
  it('lets the narrower query win', () => {
    // A compact width matches BOTH max-width queries; the narrower one is the
    // answer, or every phone would read as a tablet.
    expect(modeForMatches(true, true)).toBe('compact');
    expect(modeForMatches(false, true)).toBe('medium');
    expect(modeForMatches(false, false)).toBe('expanded');
  });

  it('matches what the queries themselves would report', () => {
    const widths = [320, 390, 600, 819, 820, 900, 1179, 1180, 1440];
    for (const w of widths) {
      const compact = w <= COMPACT_MAX - 1;
      const medium = w <= MEDIUM_MAX - 1;
      expect(modeForMatches(compact, medium)).toBe(modeForWidth(w));
    }
  });

  it('builds the queries off the same two constants', () => {
    expect(COMPACT_QUERY).toBe('(max-width: 819px)');
    expect(MEDIUM_QUERY).toBe('(max-width: 1179px)');
  });
});
