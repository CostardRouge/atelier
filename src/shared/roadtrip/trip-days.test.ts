import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayNumber,
  daysBetween,
  enumerateDays,
  formatIsoDate,
  heatmapWeeks,
  isWithin,
  monthLabels,
  parseIsoDate,
  spanLength,
  todayIso,
  toIsoDate,
  weekdayIndex,
} from './trip-days';

describe('parseIsoDate', () => {
  it('reads a well-formed date as UTC midnight', () => {
    expect(parseIsoDate('2025-03-01')).toBe(Date.UTC(2025, 2, 1));
  });

  it('refuses a date the calendar does not have', () => {
    // Date.UTC would roll this over to 2 March and silently move a trip's end.
    expect(parseIsoDate('2025-02-30')).toBeNull();
    expect(parseIsoDate('2025-13-01')).toBeNull();
    expect(parseIsoDate('2025-00-10')).toBeNull();
  });

  it('accepts a real leap day and refuses a fake one', () => {
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
    expect(parseIsoDate('2025-02-29')).toBeNull();
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(parseIsoDate('2025-3-1')).toBeNull();
    expect(parseIsoDate('01/03/2025')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('round-trips through parseIsoDate', () => {
    expect(toIsoDate(parseIsoDate('2026-02-14')!)).toBe('2026-02-14');
  });

  it('pads single-digit months and days', () => {
    expect(toIsoDate(Date.UTC(2025, 0, 5))).toBe('2025-01-05');
  });
});

describe('todayIso', () => {
  it('reads the local calendar day, not the UTC instant', () => {
    // 23:30 local on 14 March is still the 14th to the person holding the
    // camera, whatever UTC says at that moment.
    const late = new Date(2025, 2, 14, 23, 30);
    expect(todayIso(late)).toBe('2025-03-14');
    const early = new Date(2025, 2, 14, 0, 30);
    expect(todayIso(early)).toBe('2025-03-14');
  });
});

describe('addDays', () => {
  it('steps forward and backward', () => {
    expect(addDays('2025-03-01', 1)).toBe('2025-03-02');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
  });

  it('crosses a month, a year and a leap day', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('crosses a DST boundary without drifting', () => {
    // Europe/Paris springs forward on 30 March 2025; UTC arithmetic must not
    // notice. A local-Date implementation lands on the 30th twice or skips it.
    expect(addDays('2025-03-29', 1)).toBe('2025-03-30');
    expect(addDays('2025-03-30', 1)).toBe('2025-03-31');
  });

  it('stays null on a bad date', () => {
    expect(addDays('nope', 1)).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2025-03-01', '2025-03-08')).toBe(7);
    expect(daysBetween('2025-03-08', '2025-03-01')).toBe(-7);
    expect(daysBetween('2025-03-01', '2025-03-01')).toBe(0);
  });

  it('spans a DST change exactly', () => {
    // 23 h and 25 h days exist locally; in UTC every day is 24 h, so a naive
    // ms/86400000 on local dates would round to 6 or 8 here.
    expect(daysBetween('2025-03-27', '2025-04-03')).toBe(7);
  });
});

describe('dayNumber', () => {
  it('is 1-based on the departure day', () => {
    expect(dayNumber('2025-03-01', '2025-03-01')).toBe(1);
    expect(dayNumber('2025-03-01', '2025-03-27')).toBe(27);
  });

  it('counts backwards before departure rather than refusing', () => {
    expect(dayNumber('2025-03-01', '2025-02-28')).toBe(0);
    expect(dayNumber('2025-03-01', '2025-02-27')).toBe(-1);
  });
});

describe('spanLength', () => {
  it('counts both ends', () => {
    expect(spanLength('2025-03-01', '2025-03-01')).toBe(1);
    expect(spanLength('2025-03-01', '2025-03-03')).toBe(3);
  });

  it('refuses a reversed span', () => {
    expect(spanLength('2025-03-03', '2025-03-01')).toBeNull();
  });
});

describe('isWithin', () => {
  it('includes both ends', () => {
    expect(isWithin('2025-03-01', '2025-03-31', '2025-03-01')).toBe(true);
    expect(isWithin('2025-03-01', '2025-03-31', '2025-03-31')).toBe(true);
    expect(isWithin('2025-03-01', '2025-03-31', '2025-04-01')).toBe(false);
  });
});

describe('enumerateDays', () => {
  it('lists an inclusive span in order', () => {
    expect(enumerateDays('2025-03-01', '2025-03-04')).toEqual([
      '2025-03-01',
      '2025-03-02',
      '2025-03-03',
      '2025-03-04',
    ]);
  });

  it('crosses a DST boundary without losing or repeating a day', () => {
    const days = enumerateDays('2025-03-29', '2025-03-31');
    expect(days).toEqual(['2025-03-29', '2025-03-30', '2025-03-31']);
    expect(new Set(days).size).toBe(3);
  });

  it('is empty for a reversed span', () => {
    expect(enumerateDays('2025-03-04', '2025-03-01')).toEqual([]);
  });
});

describe('weekdayIndex', () => {
  it('puts Monday first', () => {
    // 3 March 2025 is a Monday.
    expect(weekdayIndex('2025-03-03')).toBe(0);
    expect(weekdayIndex('2025-03-09')).toBe(6); // Sunday
  });
});

describe('heatmapWeeks', () => {
  it('pads the first week so a day lands on its real weekday', () => {
    // 6 March 2025 is a Thursday → three empty cells before it.
    const weeks = heatmapWeeks('2025-03-06', '2025-03-09');
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2025-03-06',
      '2025-03-07',
      '2025-03-08',
      '2025-03-09',
    ]);
  });

  it('pads the last week too, so every column is seven cells', () => {
    const weeks = heatmapWeeks('2025-03-03', '2025-03-12');
    expect(weeks).toHaveLength(2);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[1].slice(3)).toEqual([null, null, null, null]);
  });

  it('keeps every trip day exactly once', () => {
    const weeks = heatmapWeeks('2025-03-01', '2026-01-04');
    const flat = weeks.flat().filter(Boolean);
    expect(flat).toHaveLength(310);
    expect(new Set(flat).size).toBe(310);
  });

  it('is empty for a reversed span', () => {
    expect(heatmapWeeks('2025-03-04', '2025-03-01')).toEqual([]);
  });
});

describe('monthLabels', () => {
  it('labels the opening column even when the trip joins mid-month', () => {
    const weeks = heatmapWeeks('2025-03-20', '2025-05-10');
    const labels = monthLabels(weeks);
    expect(labels[0]).toEqual({ column: 0, label: 'Mar' });
    expect(labels.map((l) => l.label)).toEqual(['Mar', 'Apr', 'May']);
  });

  it('gives each month one label', () => {
    const labels = monthLabels(heatmapWeeks('2025-03-01', '2025-06-30'));
    expect(labels.map((l) => l.label)).toEqual(['Mar', 'Apr', 'May', 'Jun']);
  });
});

describe('formatIsoDate', () => {
  it('reads as a human date', () => {
    expect(formatIsoDate('2025-03-14')).toBe('14 Mar 2025');
  });

  it('hands back anything it cannot parse rather than inventing one', () => {
    expect(formatIsoDate('not-a-date')).toBe('not-a-date');
  });
});
