import type { DayPoint } from './day-track';
import { haltKey, type DeduceDraft, type Proposal } from './deduce-draft';
import { enumerateDays } from './trip-days';

/**
 * What the Deduce map draws and frames: the itinerary the draft would WRITE,
 * not every halt the instance's days produced (2026-10-07, the maintainer:
 * a place he left out because it was abroad, once skipped, must leave the
 * map and its frame too — «une carte finale»).
 *
 * Out of it: a proposal the AUTHOR answered Skip (a safe Skip — a block
 * already in his stages — stays: those days are his itinerary), a halt he
 * left out of a proposal (×), and the route through their days. A key in
 * `keep` stays whatever its answer: the proposal looked at (the one edited,
 * the paquet's card, the one under the hand) is shown while he decides.
 *
 * The positions the deduction itself ignored (outliers) never reach this:
 * `points` is the days it ran over.
 */
export interface MapContent {
  proposals: Proposal[];
  route: DayPoint[];
}

export function deduceMapContent(
  proposals: readonly Proposal[],
  draft: DeduceDraft,
  points: readonly DayPoint[],
  keep: ReadonlySet<string> = new Set(),
): MapContent {
  const hidden = new Set<string>();
  const shown: Proposal[] = [];
  for (const p of proposals) {
    const skipped = draft.answers[p.key] === 'skip' && !keep.has(p.key);
    const kept = new Set(p.halts.map(haltKey));
    for (const h of p.chapter.halts) {
      if (!skipped && kept.has(haltKey(h))) continue;
      for (const day of enumerateDays(h.leg.startDate, h.leg.endDate)) hidden.add(day);
    }
    if (!skipped) shown.push(p);
  }
  return { proposals: shown, route: hidden.size ? points.filter((p) => !hidden.has(p.date)) : [...points] };
}
