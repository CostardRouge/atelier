/**
 * A month drawn as a strip of bars — one per day, its height the number of
 * media the instance holds that day.
 *
 * It answers the question a date field cannot: *which days of this month have
 * anything on them*. The instance already knows — `/api/assets/calendar` gives
 * a count per day for a span — so the strip is a reading of that answer, never
 * an estimate.
 *
 * The scale is normalised to the MONTH'S OWN peak rather than to a fixed
 * number: a quiet month has to read as a shape, not as a flat line, and the
 * absolute counts are on the labels for anyone who needs them. A day that
 * holds anything at all never draws below `FLOOR`, so one file is visibly
 * different from none — the distinction the whole strip exists to make.
 *
 * Pure and DOM-free.
 */

export interface DayBar {
  /** `YYYY-MM-DD`. */
  date: string;
  count: number;
  /** 0 for a day that holds nothing, else `FLOOR`…1 of the drawn height. */
  fill: number;
}

export interface DensityStrip {
  bars: DayBar[];
  /** The busiest day's count; 0 when the month holds nothing. */
  peak: number;
  /** Every file the month holds, across its days. */
  total: number;
}

/**
 * The shortest a bar with something in it may draw, as a fraction of the peak.
 * Below about a fifth it reads as noise against the empty days' stub.
 */
export const FLOOR = 0.22;

/**
 * The strip for `days`, counted by `counts` (a day the map does not name holds
 * nothing). The days are echoed in the order they were given — the caller owns
 * the calendar arithmetic, this owns only the reading.
 */
export function densityStrip(
  days: readonly string[],
  counts: ReadonlyMap<string, number>,
): DensityStrip {
  let peak = 0;
  let total = 0;
  for (const day of days) {
    const n = counts.get(day) ?? 0;
    if (n > peak) peak = n;
    total += n;
  }
  const bars = days.map((date) => {
    const count = counts.get(date) ?? 0;
    return {
      date,
      count,
      fill: count === 0 || peak === 0 ? 0 : FLOOR + (1 - FLOOR) * (count / peak),
    };
  });
  return { bars, peak, total };
}
