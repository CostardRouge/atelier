import type { DiffEntry } from '../../shared/roadtrip/timeline-import';
import { formatIsoDate, spanLength } from '../../shared/roadtrip/trip-days';
import { PLACE_ARROW, stageLabel } from '../../shared/roadtrip/trip-places';
import type { TripStage } from '../../shared/roadtrip/trip-types';

/**
 * What a reconcile would do to a trip's legs, one tick per line — shared the
 * day the itinerary DEDUCTION became its second consumer, exactly as
 * `StylePanel` and `GradePanel` went shared on theirs.
 *
 * It is deliberately ignorant of where the legs came from. `diffTimeline`
 * already speaks one language whether a chapter was read off an instance's
 * timeline or worked out here from one position per day, so the list draws
 * `DiffEntry` and nothing else. A producer that wants to say more about a row
 * — "a stop on the way", "placed from guesses" — hands in `noteFor`, and the
 * list never learns what those words mean.
 *
 * The rules it keeps for both hosts: a `dropped` row is never ticked by
 * default (a source does not remove a leg on its own), an `unchanged` row that
 * is already linked is shown INERT rather than hidden (the author sees the
 * whole comparison), and the pairing is named whenever it was not by id, since
 * matching by span or place is a near-match the author should weigh.
 */

const row =
  'flex items-start gap-3 py-2 border-b border-line last:border-b-0 text-sm leading-snug';
const check =
  'mt-[3px] w-[15px] h-[15px] accent-ink flex-none max-[820px]:w-[18px] max-[820px]:h-[18px]';

/** `5 Nov 2025 → 8 Nov 2025 · 4 days`, or one day. */
export function spanText(start: string, end: string): string {
  const days = spanLength(start, end);
  const dates =
    start === end ? formatIsoDate(start) : `${formatIsoDate(start)} → ${formatIsoDate(end)}`;
  return days === null ? dates : `${dates} · ${days} day${days === 1 ? '' : 's'}`;
}

function routeOf(stage: TripStage): string {
  return (stage.places ?? [])
    .map((p) => p.name.trim())
    .filter(Boolean)
    .join(` ${PLACE_ARROW} `);
}

/** What accepting one entry would do, in a sentence. */
export function describe(entry: DiffEntry): string {
  const incoming = entry.incoming;
  const existing = entry.existing;
  switch (entry.kind) {
    case 'add':
      return `Add “${stageLabel(incoming!) || 'an unnamed leg'}” · ${spanText(incoming!.startDate, incoming!.endDate)}`;
    case 'dropped':
      return `Drop “${stageLabel(existing!) || 'an unnamed leg'}” · ${spanText(existing!.startDate, existing!.endDate)} — it is no longer there`;
    case 'unchanged':
      return existing!.origin
        ? `“${stageLabel(existing!)}” · unchanged`
        : `“${stageLabel(existing!) || 'an unnamed leg'}” matches one of these legs — link it, so the next run finds it`;
    case 'changed': {
      const parts: string[] = [];
      if (entry.changes.includes('name')) {
        parts.push(`now called “${stageLabel(incoming!) || 'nothing'}”`);
      }
      if (entry.changes.includes('span')) {
        parts.push(`now ${spanText(incoming!.startDate, incoming!.endDate)}`);
      }
      if (entry.changes.includes('places')) {
        parts.push(`route now ${routeOf(incoming!) || 'no place'}`);
      }
      return `“${stageLabel(existing!) || 'an unnamed leg'}” · ${parts.join(' · ')}`;
    }
  }
}

/** An entry already linked and identical: shown, never actionable. */
export function isInert(entry: DiffEntry): boolean {
  return entry.kind === 'unchanged' && !!entry.existing?.origin;
}

/** Entries the author can actually do something with. */
export function actionableOf(entries: readonly DiffEntry[]): DiffEntry[] {
  return entries.filter((e) => !isInert(e));
}

/**
 * The default tick: take what the source gained or moved, link what it
 * matched, and never drop on its own. `holdBack` is the producer's own doubt —
 * rows it would rather the author looked at before accepting.
 */
export function defaultAccepted(
  entries: readonly DiffEntry[],
  holdBack: ReadonlySet<string> = new Set(),
): Set<string> {
  return new Set(
    entries
      .filter(
        (e) =>
          e.kind === 'add' ||
          e.kind === 'changed' ||
          (e.kind === 'unchanged' && !e.existing?.origin),
      )
      .filter((e) => !holdBack.has(e.key))
      .map((e) => e.key),
  );
}

export function toggle(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

interface StageDiffListProps {
  entries: readonly DiffEntry[];
  ticked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** A word the producer wants on a row, under the sentence. */
  noteFor?: (entry: DiffEntry) => string | null;
}

export default function StageDiffList({
  entries,
  ticked,
  onToggle,
  noteFor,
}: StageDiffListProps) {
  return (
    <ul className="m-0 p-0 list-none flex flex-col border border-line rounded-paper px-3 max-h-[22rem] overflow-auto">
      {entries.map((e) => {
        const inert = isInert(e);
        const note = noteFor?.(e) ?? null;
        return (
          <li key={e.key} className={`${row} ${inert ? 'text-muted' : ''}`}>
            <input
              type="checkbox"
              className={check}
              checked={!inert && ticked.has(e.key)}
              disabled={inert}
              onChange={() => onToggle(e.key)}
              aria-label={describe(e)}
            />
            <span className="min-w-0 flex-1">
              <span
                className={`font-mono text-3xs tracking-[0.1em] uppercase mr-2 ${
                  e.kind === 'dropped' ? 'text-danger' : 'text-muted'
                }`}
              >
                {e.kind === 'unchanged' && !inert ? 'link' : e.kind}
                {e.matchedBy && e.matchedBy !== 'id' && ` · matched by ${e.matchedBy}`}
              </span>
              {describe(e)}
              {note && (
                <span className="block font-mono text-2xs text-warn tabular-nums">{note}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
