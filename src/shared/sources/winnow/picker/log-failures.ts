/**
 * A flight log the instance could not hand over, and the sentence that says
 * so — pure.
 *
 * A Winnow lists a clip from its database and draws it from its own cache
 * (the thumbnail, the proxy), but streams a SIDECAR from the clip's source
 * folder on disk (`/api/sidecars/:id/download` reads `abs_path`, and answers
 * 404 "Sidecar file is not reachable" when that file is gone). So a clip
 * ingested from a drive that is no longer mounted lists, plays and reads as
 * "with a log" — and its `.srt` cannot be read. One such log used to stop a
 * whole *Logs only* add at the first miss (156 flights ticked, 23 landed) and
 * was drawn in the Logbook as a flight with "no fix".
 */

import { WinnowError } from '../client';

/**
 * `unreachable` when the instance answered that the file is not there (its
 * 404 — the drive is gone, or the file moved), `failed` for anything else.
 */
export type LogFailure = 'unreachable' | 'failed';

export function logFailureOf(err: unknown): LogFailure {
  return err instanceof WinnowError && err.kind === 'notfound' ? 'unreachable' : 'failed';
}

export interface FailedLog {
  filename: string;
  why: LogFailure;
  message: string;
}

const logs = (n: number) => `${n} log${n === 1 ? '' : 's'}`;

/**
 * What an add that missed some logs says, in the picker's status line: what
 * landed, how many did not and why — the drive first, since that is the
 * common case and the one the person can cure.
 */
export function logFailureText(failed: readonly FailedLog[], added: number, host: string): string {
  const unreachable = failed.filter((f) => f.why === 'unreachable').length;
  const other = failed.length - unreachable;
  const parts: string[] = [];
  if (added) parts.push(`${logs(added)} added`);
  if (unreachable) {
    parts.push(
      `${logs(unreachable)} not on ${host}'s disk — it lists ${unreachable === 1 ? 'that clip' : 'those clips'} but cannot read the .srt (is the drive ${unreachable === 1 ? 'it was' : 'they were'} ingested from plugged in?)`,
    );
  }
  if (other) {
    const first = failed.find((f) => f.why === 'failed');
    parts.push(`${logs(other)} could not be fetched${first ? ` (${first.filename}: ${first.message})` : ''}`);
  }
  return parts.join(' · ');
}
