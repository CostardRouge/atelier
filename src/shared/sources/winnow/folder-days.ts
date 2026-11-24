import type { WinnowSession } from './client';

/** The first and last day a Winnow folder was shot on, `YYYY-MM-DD`, or null when it holds no dated media. */
export interface FolderDays {
  from: string | null;
  to: string | null;
}

/**
 * A folder's days, read in the zone of the device looking at it.
 *
 * Winnow's `/api/sessions` gives a folder only its first and last INSTANTS
 * (`captured_at_min` / `_max`, UTC ISO strings) — no `capture_date`, the
 * place's local day that every other listing carries. Slicing the ISO string
 * gave the UTC day: in Australia (UTC+11) a morning shoot listed a day early,
 * so Sony's `10061122` folder (the camera's 22 November) read `2026-11-21`
 * while the Day scope, on Winnow's local days, showed its pictures on the 22nd
 * (his report, 2026-11-24). The device's zone is where he browses and, most of
 * the time, where he shot; a folder shot in another zone may still be off by
 * one, until Winnow sends a folder's own local days.
 */
export function folderDays(
  s: Pick<WinnowSession, 'captured_at_min' | 'captured_at_max'>,
  zone?: string,
): FolderDays {
  const from = dayIn(s.captured_at_min, zone);
  const to = dayIn(s.captured_at_max, zone);
  return { from: from ?? to, to: to ?? from };
}

/** `a → b`, one day alone, or a dash when the folder holds nothing dated. */
export function folderDaysLabel(days: FolderDays): string {
  const { from, to } = days;
  return from && to && from !== to ? `${from} → ${to}` : (from ?? '—');
}

/** Whether a folder was shot on at least one day of `[from, to]` (either bound may be open). */
export function folderOverlaps(days: FolderDays, from: string | null, to: string | null): boolean {
  if (!days.from || !days.to) return !from && !to;
  return (!from || days.to >= from) && (!to || days.from <= to);
}

function dayIn(instant: string | null | undefined, zone: string | undefined): string | null {
  if (!instant) return null;
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(t));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
