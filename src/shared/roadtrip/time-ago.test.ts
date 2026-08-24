import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_AGO_WORDS,
  FRENCH_TIME_AGO_WORDS,
  autoMode,
  timeAgoLine,
  timeAgoPreviews,
  timeGap,
  TIME_AGO_MODES,
  type TimeAgoMode,
} from './time-ago';

const W = DEFAULT_TIME_AGO_WORDS;
const line = (from: string, to: string, mode: TimeAgoMode, words = W) =>
  timeAgoLine(from, to, mode, words);

describe('timeGap', () => {
  it('measures every unit of one gap', () => {
    const gap = timeGap('2025-03-27', '2026-08-24')!;
    expect(gap.days).toBe(515);
    expect(gap.weeks).toBe(73);
    expect(gap.months).toBe(16);
    expect(gap.years).toBe(1);
  });

  it('calls a date an anniversary only on the same month and day', () => {
    expect(timeGap('2025-03-27', '2026-03-27')!.isAnniversary).toBe(true);
    expect(timeGap('2025-03-27', '2026-03-28')!.isAnniversary).toBe(false);
    expect(timeGap('2025-03-27', '2027-03-27')!.isAnniversary).toBe(true);
  });

  it('is not an anniversary under a year, even on the same day of the month', () => {
    expect(timeGap('2025-03-27', '2025-09-27')!.isAnniversary).toBe(false);
  });

  it('is null on an unreadable date', () => {
    expect(timeGap('nope', '2026-03-27')).toBeNull();
  });
});

describe('autoMode', () => {
  const gapOf = (from: string, to: string) => timeGap(from, to)!;

  it('prefers the anniversary on the day it really is one', () => {
    expect(autoMode(gapOf('2025-03-27', '2026-03-27'))).toBe('anniversary');
  });

  it('falls to years + months the rest of the year', () => {
    expect(autoMode(gapOf('2025-03-27', '2026-08-24'))).toBe('years-months');
  });

  it('uses months, then weeks, then days as the gap shortens', () => {
    expect(autoMode(gapOf('2025-03-27', '2025-09-01'))).toBe('months-ago');
    expect(autoMode(gapOf('2025-03-27', '2025-04-20'))).toBe('weeks-ago');
    expect(autoMode(gapOf('2025-03-27', '2025-04-02'))).toBe('days-ago');
  });
});

describe('timeAgoLine — the anniversary never lies', () => {
  it('speaks on the real anniversary', () => {
    expect(line('2025-03-27', '2026-03-27', 'anniversary')).toBe('1 year ago today');
    expect(line('2025-03-27', '2028-03-27', 'anniversary')).toBe('3 years ago today');
  });

  it('says NOTHING one day either side — the old bug', () => {
    // The retired boolean fired on any date a year or more later, announcing
    // an anniversary on days that were not one.
    expect(line('2025-03-27', '2026-03-26', 'anniversary')).toBeNull();
    expect(line('2025-03-27', '2026-03-28', 'anniversary')).toBeNull();
    expect(line('2025-03-27', '2026-08-24', 'anniversary')).toBeNull();
  });

  it('says nothing before the first anniversary', () => {
    expect(line('2025-03-27', '2025-09-27', 'anniversary')).toBeNull();
  });
});

describe('timeAgoLine — the counting modes', () => {
  it('counts days', () => {
    expect(line('2025-03-27', '2026-08-24', 'days-ago')).toBe('515 days ago');
  });

  it('counts weeks', () => {
    expect(line('2025-03-27', '2026-08-24', 'weeks-ago')).toBe('73 weeks ago');
  });

  it('counts months', () => {
    expect(line('2025-03-27', '2026-08-24', 'months-ago')).toBe('16 months ago');
  });

  it('counts years and the months past them', () => {
    expect(line('2025-03-27', '2026-08-24', 'years-months')).toBe(
      '1 year 4 months ago',
    );
  });

  it('drops the months when a whole number of years has passed', () => {
    expect(line('2025-03-27', '2027-03-27', 'years-months')).toBe('2 years ago');
  });

  it('falls back to months when a year has not passed', () => {
    expect(line('2025-03-27', '2025-09-01', 'years-months')).toBe('5 months ago');
  });

  it('picks the noun by the number, never by a rule', () => {
    expect(line('2025-03-27', '2025-03-28', 'days-ago')).toBe('1 day ago');
    expect(line('2025-03-27', '2025-04-03', 'weeks-ago')).toBe('1 week ago');
  });

  it('states a date without arithmetic for "since"', () => {
    expect(line('2025-03-27', '2026-08-24', 'since')).toBe('since 27 Mar 2025');
  });
});

describe('timeAgoLine — auto', () => {
  it('lands on the anniversary line on the day', () => {
    expect(line('2025-03-27', '2026-03-27', 'auto')).toBe('1 year ago today');
  });

  it('lands on something true every other day', () => {
    expect(line('2025-03-27', '2026-08-24', 'auto')).toBe('1 year 4 months ago');
    expect(line('2025-03-27', '2025-04-02', 'auto')).toBe('6 days ago');
  });

  it('never returns null for a real past gap', () => {
    // Auto is the mode a user leaves on and forgets; it must always have
    // something true to say.
    for (const to of [
      '2025-03-28',
      '2025-04-10',
      '2025-06-01',
      '2026-03-27',
      '2026-08-24',
      '2030-01-01',
    ]) {
      expect(line('2025-03-27', to, 'auto')).not.toBeNull();
    }
  });
});

describe('timeAgoLine — nothing to say', () => {
  it('is silent when the reference is the picture’s own day', () => {
    expect(line('2025-03-27', '2025-03-27', 'auto')).toBeNull();
    expect(line('2025-03-27', '2025-03-27', 'days-ago')).toBeNull();
  });

  it('is silent about the future', () => {
    expect(line('2025-03-27', '2025-03-01', 'auto')).toBeNull();
  });

  it('is silent when switched off', () => {
    expect(line('2025-03-27', '2026-08-24', 'off')).toBeNull();
  });

  it('still states the date for "since", which needs no elapsed time', () => {
    expect(line('2025-03-27', '2025-03-27', 'since')).toBe('since 27 Mar 2025');
  });

  it('is silent on an unreadable date', () => {
    expect(line('nope', '2026-08-24', 'auto')).toBeNull();
  });
});

describe('timeAgoLine — the words are data', () => {
  it('reads in French when handed the French vocabulary', () => {
    expect(line('2025-03-27', '2026-08-24', 'days-ago', FRENCH_TIME_AGO_WORDS)).toBe(
      'il y a 515 jours',
    );
    expect(line('2025-03-27', '2026-03-27', 'anniversary', FRENCH_TIME_AGO_WORDS)).toBe(
      'il y a 1 an, jour pour jour',
    );
  });

  it('handles a language whose plural is the same word', () => {
    // "mois" is both — the noun table decides, no rule invents an s.
    expect(line('2025-03-27', '2025-04-30', 'months-ago', FRENCH_TIME_AGO_WORDS)).toBe(
      'il y a 1 mois',
    );
  });

  it('takes an entirely invented template', () => {
    expect(
      line('2025-03-27', '2026-08-24', 'days-ago', {
        ...W,
        agoTemplate: '↺ {n}',
      }),
    ).toBe('↺ 515 days');
  });
});

describe('timeAgoPreviews', () => {
  const W = DEFAULT_TIME_AGO_WORDS;

  it('gives the real line for this picture, not an example', () => {
    const byId = Object.fromEntries(
      timeAgoPreviews('2025-03-27', '2026-08-24', W).map((p) => [p.id, p.text]),
    );
    expect(byId['days-ago']).toBe('515 days ago');
    expect(byId['since']).toBe('since 27 Mar 2025');
    expect(byId['off']).toBeNull();
  });

  it('is null for a mode with nothing true to say', () => {
    const byId = Object.fromEntries(
      timeAgoPreviews('2025-03-27', '2026-08-24', W).map((p) => [p.id, p.text]),
    );
    // Not the anniversary on 24 August.
    expect(byId['anniversary']).toBeNull();
  });

  it('moves with the picture’s day — nothing here is fixed', () => {
    const a = timeAgoPreviews('2025-03-27', '2026-08-24', W);
    const b = timeAgoPreviews('2025-11-17', '2026-08-24', W);
    expect(a.find((p) => p.id === 'days-ago')!.text).not.toBe(
      b.find((p) => p.id === 'days-ago')!.text,
    );
  });

  it('covers every mode the panel offers', () => {
    expect(timeAgoPreviews('2025-03-27', '2026-08-24', W)).toHaveLength(
      TIME_AGO_MODES.length,
    );
  });
});
