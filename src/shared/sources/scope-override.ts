/**
 * The day the Library's instance tab looks at when it is NOT the one the
 * active tool published.
 *
 * A tool publishes the span it is on (`media-scope.tsx`) and the tab follows
 * it. But the day before and the day after are worth looking at from a piece
 * of another day — a teaser, a picture shot past midnight — without moving the
 * piece. So the sidebar keeps an override of its own, and the tool never
 * learns of it: the seam stays one-way, and the piece's date is untouched.
 *
 * The override is ANCHORED to the span it was taken from and holds only while
 * that span is still what is published. Opening another piece, or another day
 * of the overview, therefore gives the tab back to the tool with no effect to
 * reset anything — a stale override is not a state this can reach, which is
 * the "pile of days visited" the instance's tab was designed to never become
 * (`architecture.md`). Nothing here is persisted, for the same reason.
 *
 * An override is always ONE day, whatever the anchor spans: stepping out of a
 * three-day piece lands on the day before its first or after its last.
 *
 * Plain `YYYY-MM-DD` strings in UTC, and no import from Road Trip: a generic
 * seam must not take the shape of one tool (the same rule as `MediaScope`).
 */

export interface DaySpan {
  /** Inclusive, `YYYY-MM-DD` each. */
  from: string;
  to: string;
}

export interface DayOverride {
  /** The published span this was taken from. */
  anchor: DaySpan;
  /** The one day looked at instead. */
  day: string;
}

export interface ViewedSpan extends DaySpan {
  /** What the tool published, or null when no tool says anything. */
  anchor: DaySpan | null;
  /** True while the tab looks somewhere the tool is not. */
  overridden: boolean;
}

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(iso: string): number | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `iso` moved by whole days; null when it is not a date. Pure. */
export function shiftDay(iso: string, days: number): string | null {
  const ms = parse(iso);
  return ms === null ? null : format(ms + days * DAY_MS);
}

/** Whole days from `a` to `b`, negative when `b` is earlier. Pure. */
function daysFrom(a: string, b: string): number | null {
  const x = parse(a);
  const y = parse(b);
  return x === null || y === null ? null : Math.round((y - x) / DAY_MS);
}

function sameSpan(a: DaySpan, b: DaySpan): boolean {
  return a.from === b.from && a.to === b.to;
}

/**
 * What the tab lists: the override while its anchor is still published, else
 * the published span, else the day picked by hand when no tool publishes.
 * Pure.
 */
export function viewedSpan(
  published: DaySpan | null,
  override: DayOverride | null,
  manualDay: string,
): ViewedSpan {
  if (!published) return { from: manualDay, to: manualDay, anchor: null, overridden: false };
  const anchor = { from: published.from, to: published.to };
  if (override && sameSpan(override.anchor, anchor)) {
    return { from: override.day, to: override.day, anchor, overridden: true };
  }
  return { ...anchor, anchor, overridden: false };
}

/**
 * One step out of what is shown: the day before its first day, or the day
 * after its last. For a single day, simply the neighbour. Pure.
 */
export function stepOut(span: DaySpan, dir: -1 | 1): string | null {
  return shiftDay(dir < 0 ? span.from : span.to, dir);
}

/**
 * The override that looking at `day` means under `anchor` — or null when
 * `day` IS a single-day anchor, because stepping back onto the tool's own day
 * is following it again, not a second state that happens to look the same.
 * Pure.
 */
export function overrideTo(anchor: DaySpan, day: string): DayOverride | null {
  return anchor.from === anchor.to && anchor.from === day ? null : { anchor, day };
}

/**
 * Where `day` sits against the anchor, in the words the tab prints — "the day
 * before", "3 days after", "day 2 of 4". Measured from the anchor, never from
 * today: from a piece, "yesterday" is the day before the PIECE. Null for a bad
 * date. Pure.
 */
export function relativeToAnchor(day: string, anchor: DaySpan): string | null {
  const before = daysFrom(day, anchor.from);
  const after = daysFrom(anchor.to, day);
  const length = daysFrom(anchor.from, anchor.to);
  if (before === null || after === null || length === null) return null;
  if (before > 0) return before === 1 ? 'the day before' : `${before} days before`;
  if (after > 0) return after === 1 ? 'the day after' : `${after} days after`;
  if (length === 0) return 'the same day';
  return `day ${1 - before} of ${length + 1}`;
}
