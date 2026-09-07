/**
 * What the sources screen needs to say about a source — pure, DOM-free.
 *
 * Three jobs, none of which belongs in a component:
 *
 * - **A health state and the sentence that goes with it.** A connection is
 *   not a boolean: an instance can answer, refuse (401 — sign in *there*),
 *   or never answer at all, and each of those asks for a different verb. The
 *   mapping from a `WinnowError` to that state is the same everywhere, so it
 *   lives here rather than in the screen that happens to show it first.
 * - **How many documents a source holds.** Forgetting a connection strands
 *   every trip and project whose `sourceId` is that host, so the screen must
 *   be able to count them BEFORE it asks — "8 projects and 3 trips live
 *   there" is the difference between a decision and a surprise.
 * - **A short label for a host.** `winnow.steeve.website` in a 288px library
 *   tab truncated to `WINNOW.STEEVE.…`, which reads as a defect. The first
 *   label is what a person calls the instance — but only while it stays
 *   unambiguous, hence {@link shortHosts} deciding for the whole set rather
 *   than one host at a time.
 */

import { WinnowError } from './winnow/client';

/** Where an instance stands, the last time this session asked. */
export type HealthState =
  /** Asked, no answer yet. */
  | 'checking'
  /** `/api/capabilities` answered: the sheet on screen is fresh. */
  | 'reachable'
  /** 401/403 — the instance is up and does not know (or allow) this browser. */
  | 'signin'
  /** No answer at all: offline, wrong address, CORS refused, or 5xx. */
  | 'unreachable';

export interface SourceHealth {
  state: HealthState;
  /** What went wrong, in the reader's terms. `null` while fine or checking. */
  reason: string | null;
  /** Round trip of the capabilities call, when it answered. */
  latencyMs: number | null;
  /** When this session last asked. `null` before the first answer. */
  checkedAt: number | null;
}

export const CHECKING: SourceHealth = {
  state: 'checking',
  reason: null,
  latencyMs: null,
  checkedAt: null,
};

/** The health a failed probe leaves behind — the error mapped to a sentence. */
export function healthFromError(err: unknown, host: string, now = Date.now()): SourceHealth {
  const kind = err instanceof WinnowError ? err.kind : null;
  if (kind === 'unauthenticated' || kind === 'forbidden') {
    return {
      state: 'signin',
      reason:
        kind === 'forbidden'
          ? `${host} knows this browser but will not answer for this account.`
          : `${host} does not know this browser. Sign in there, then check again — the session stays in that site's cookie, never here.`,
      latencyMs: null,
      checkedAt: now,
    };
  }
  return {
    state: 'unreachable',
    reason:
      kind === 'unreachable'
        ? `No answer from ${host}. It may be offline, or this browser may not be on its allowed list.`
        : `${host} answered something this app could not read${
            err instanceof Error && err.message ? `: ${err.message}` : '.'
          }`,
    latencyMs: null,
    checkedAt: now,
  };
}

/** The health a successful probe leaves behind. */
export function healthFromAnswer(latencyMs: number, now = Date.now()): SourceHealth {
  return { state: 'reachable', reason: null, latencyMs, checkedAt: now };
}

export interface DocCount {
  projects: number;
  trips: number;
}

export const NO_DOCS: DocCount = { projects: 0, trips: 0 };

/**
 * How many documents each source holds, counted from the two local stores.
 *
 * A document with no `sourceId` was written before the field existed and
 * belongs to this browser — the same rule `groupBySource` applies, kept
 * identical on purpose so the gallery and this screen never disagree.
 */
export function countBySource(
  projects: readonly { sourceId?: string }[],
  trips: readonly { sourceId?: string }[],
  localId = 'local',
): Map<string, DocCount> {
  const counts = new Map<string, DocCount>();
  const bump = (id: string | undefined, key: keyof DocCount) => {
    const at = id ?? localId;
    const current = counts.get(at) ?? { projects: 0, trips: 0 };
    counts.set(at, { ...current, [key]: current[key] + 1 });
  };
  for (const p of projects) bump(p.sourceId, 'projects');
  for (const t of trips) bump(t.sourceId, 'trips');
  return counts;
}

/** "8 projects and 3 trips", "one trip", "nothing yet" — never "0 projects". */
export function describeDocs(count: DocCount): string {
  const parts: string[] = [];
  if (count.projects > 0) {
    parts.push(count.projects === 1 ? 'one project' : `${count.projects} projects`);
  }
  if (count.trips > 0) parts.push(count.trips === 1 ? 'one trip' : `${count.trips} trips`);
  if (parts.length === 0) return 'nothing yet';
  return parts.join(' and ');
}

/**
 * What forgetting a connection actually does, said before it is done.
 *
 * The documents are not deleted: they live on the instance, and connecting
 * again brings them back. What goes is this browser's copy and the ability to
 * save to that host — which is the part a person needs to hear.
 */
export function forgetWarning(host: string, count: DocCount): string {
  const held = describeDocs(count);
  return held === 'nothing yet'
    ? `Forget ${host}? Its media stop showing in the library. Nothing is deleted there.`
    : `Forget ${host}? ${held} came from it — those stay on the instance, and connecting again brings them back, but this browser stops listing and saving them.`;
}

/**
 * The name a host goes by in a tab: its first label, with the port when it
 * carries one (`localhost:5174` is a different instance from `localhost`).
 */
export function shortHost(host: string): string {
  const [name = '', port] = host.split(':');
  const labels = name.split('.').filter(Boolean);
  if (labels.length === 0) return host;
  const first = labels[0] === 'www' && labels.length > 1 ? labels[1] : labels[0];
  // An address is what it is: `192.168.1.4` shortened to `192` names nothing.
  const head = /^\d+$/.test(first) ? name : first;
  return port ? `${head}:${port}` : head;
}

/**
 * Short names for a whole set of hosts, where a collision falls back to the
 * full host for the hosts that collide — `winnow.a.tech` and `winnow.b.tech`
 * both stay long rather than both reading "winnow".
 */
export function shortHosts(hosts: readonly string[]): Map<string, string> {
  const byShort = new Map<string, string[]>();
  for (const host of hosts) {
    const short = shortHost(host);
    byShort.set(short, [...(byShort.get(short) ?? []), host]);
  }
  const out = new Map<string, string>();
  for (const [short, group] of byShort) {
    for (const host of group) out.set(host, group.length === 1 ? short : host);
  }
  return out;
}
