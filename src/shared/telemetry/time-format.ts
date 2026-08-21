/**
 * Capture-time formatting — pure, DOM-free, machine-independent.
 *
 * **What DJI actually writes.** The `.srt` carries a bare wall-clock string:
 * `2026-05-30 05:49:34.609`. There is no UTC offset and no zone name — it is
 * whatever the aircraft's clock said, which is whatever the controller (and
 * before it, the phone) had set. Nothing in the file says where on Earth that
 * reading belongs.
 *
 * **Why there is no timezone picker.** Converting a timestamp between zones
 * needs to know the zone it came FROM. We don't, and guessing "it's UTC" would
 * be wrong for most flights. A zone dropdown would be false precision: it would
 * look authoritative while producing an arbitrary answer. What is honest — and
 * what actually fixes the real cases — is a **shift**: the author knows their
 * clock was an hour off, or set to the wrong day, and says so. Hours and
 * minutes both, because real offsets include :30 and :45 (India, Nepal,
 * Chatham); whole days too, for a controller that came back from a flat
 * battery with the wrong date.
 *
 * **Why the arithmetic runs in UTC.** Parsing into a local `Date` would let the
 * *rendering machine's* zone silently move the value, so a preview and an
 * export on two computers could disagree. Every calculation here goes through
 * `Date.UTC` and `getUTC*`, which are zone-free: the same input always renders
 * the same string, everywhere.
 */

/** A calendar reading with no zone attached — exactly what the SRT gives us. */
export interface WallClock {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number;
  second: number;
  ms: number;
}

export type DateStyle =
  | 'iso' // 2026-05-30
  | 'dmy' // 30/05/2026
  | 'mdy' // 05/30/2026
  | 'long-dmy' // 30 May 2026
  | 'long-mdy' // May 30, 2026
  | 'weekday'; // Sat 30 May 2026

export interface TimeFormatOptions {
  /** 12-hour clock rather than 24-hour. Default false. */
  hour12?: boolean;
  /** Print AM/PM. Only meaningful with `hour12`. Default true. */
  meridiem?: boolean;
  /** Include seconds. Default true. */
  seconds?: boolean;
  /** Include milliseconds (the SRT has them). Default false. */
  milliseconds?: boolean;
  /** How a date reads. Default 'iso'. */
  dateStyle?: DateStyle;
}

/** A correction applied to the capture time. See the note above. */
export interface TimeShift {
  /** Signed minutes — carries into hours and rolls the date. */
  minutes: number;
  /** Signed whole days, for a clock set to the wrong date entirely. */
  days: number;
}

export const NO_SHIFT: TimeShift = { minutes: 0, days: 0 };

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STAMP_RE =
  /(\d{4})[-/](\d{1,2})[-/](\d{1,2})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?/;

/**
 * Read a DJI timestamp line into calendar parts. Returns null when the string
 * carries no recognisable date-and-time, so callers fall back to “—” rather
 * than to a fabricated moment.
 */
export function parseWallClock(stamp: string | null | undefined): WallClock | null {
  if (!stamp) return null;
  const m = STAMP_RE.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const clock: WallClock = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: s ? Number(s) : 0,
    ms: ms ? Number(ms.padEnd(3, '0')) : 0,
  };
  if (clock.month < 1 || clock.month > 12 || clock.day < 1 || clock.day > 31) {
    return null;
  }
  if (clock.hour > 23 || clock.minute > 59 || clock.second > 59) return null;
  return clock;
}

/** Epoch millis treating the reading as if it were UTC — a zone-free ruler. */
function toEpoch(wc: WallClock): number {
  return Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second, wc.ms);
}

function fromEpoch(ms: number): WallClock {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

/**
 * Apply the author's correction. Minutes carry naturally into hours and roll
 * the date — 23:30 shifted +60 is 00:30 the next day, which is the whole point
 * of doing this on a real calendar rather than with a modulo on the hour.
 */
export function shiftWallClock(wc: WallClock, shift?: TimeShift | null): WallClock {
  if (!shift || (shift.minutes === 0 && shift.days === 0)) return wc;
  const ms = toEpoch(wc) + shift.minutes * 60_000 + shift.days * 86_400_000;
  return fromEpoch(ms);
}

/** Day of the week for a reading, 0 = Sunday. */
export function weekdayOf(wc: WallClock): number {
  return new Date(toEpoch(wc)).getUTCDay();
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** The time of day, e.g. `05:49:34`, `5:49:34 AM`, `17:49`. */
export function formatClock(wc: WallClock, opts: TimeFormatOptions = {}): string {
  const hour12 = opts.hour12 ?? false;
  const showSeconds = opts.seconds ?? true;

  // 12-hour hours are unpadded (1:05 PM, not 01:05 PM); 24-hour hours are
  // padded, which is what keeps a HUD readout from twitching in width.
  let hour: string;
  let suffix = '';
  if (hour12) {
    const h = wc.hour % 12 === 0 ? 12 : wc.hour % 12;
    hour = String(h);
    if (opts.meridiem ?? true) suffix = wc.hour < 12 ? ' AM' : ' PM';
  } else {
    hour = pad(wc.hour);
  }

  let text = `${hour}:${pad(wc.minute)}`;
  if (showSeconds) text += `:${pad(wc.second)}`;
  if (opts.milliseconds) text += `.${pad(wc.ms, 3)}`;
  return text + suffix;
}

/** The calendar date in the chosen style. */
export function formatDate(wc: WallClock, opts: TimeFormatOptions = {}): string {
  const mon = MONTHS[wc.month - 1];
  switch (opts.dateStyle ?? 'iso') {
    case 'dmy':
      return `${pad(wc.day)}/${pad(wc.month)}/${wc.year}`;
    case 'mdy':
      return `${pad(wc.month)}/${pad(wc.day)}/${wc.year}`;
    case 'long-dmy':
      return `${wc.day} ${mon} ${wc.year}`;
    case 'long-mdy':
      return `${mon} ${wc.day}, ${wc.year}`;
    case 'weekday':
      return `${WEEKDAYS[weekdayOf(wc)]} ${wc.day} ${mon} ${wc.year}`;
    case 'iso':
    default:
      return `${wc.year}-${pad(wc.month)}-${pad(wc.day)}`;
  }
}

/** Date and time together, each in its chosen style. */
export function formatTimestamp(wc: WallClock, opts: TimeFormatOptions = {}): string {
  return `${formatDate(wc, opts)} ${formatClock(wc, opts)}`;
}
