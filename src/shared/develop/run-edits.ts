/**
 * The pictures of a roll's export run that were EDITED while it went on (L2
 * of the 2026-09-28 lab): the run renders from the roll as it was at the
 * click, so their files are from before — measured with the export marks' own
 * fingerprint, so what is said here is exactly what the table will call
 * `changed` afterwards. The run's progress itself is `shared/tasks/run-progress.ts`.
 *
 * Pure and DOM-free.
 */

import { exportKey } from './export-marks';
import { pictureLabel, type RollPicture } from './roll-types';

export function editedDuringRun(sent: readonly RollPicture[], now: readonly RollPicture[]): RollPicture[] {
  const current = new Map(now.map((p) => [p.id, p]));
  return sent.filter((p) => {
    const later = current.get(p.id);
    return later !== undefined && exportKey(later) !== exportKey(p);
  });
}

/** The run's first sentence when a picture moved under it — or null when none did. */
export function describeEditedDuring(pictures: readonly RollPicture[]): string | null {
  if (pictures.length === 0) return null;
  const who = pictures.length === 1 ? pictureLabel(pictures[0]) : `${pictures.length} pictures`;
  const were = pictures.length === 1 ? 'was' : 'were';
  return `${who} ${were} edited during the export and left as ${pictures.length === 1 ? 'it was' : 'they were'} at the click — Export new or changed sends ${pictures.length === 1 ? 'it' : 'them'} again.`;
}
