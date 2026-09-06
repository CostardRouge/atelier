/**
 * What every document kept on a connected instance shares — the plumbing
 * under `roadtrip/trip-remote.ts` and `projects/project-remote.ts`: which
 * instance a source id names, one guarded PUT, and how a client failure maps
 * onto the reducer's vocabulary (`doc-sync.ts`). No policy lives here: the
 * reducer decides, the pill speaks, the tools trigger.
 *
 * No DOM. Every function here either returns an outcome or throws the
 * client's own `WinnowError`; nothing retries a write on its own.
 */

import { DOCS_APP, WinnowClient, WinnowError } from './winnow/client';
import { getWinnowConnection } from './winnow/store';
import { DEFAULT_SOURCE_ID } from './source';
import type { PushFailure, SyncEvent, TheirCopy } from './doc-sync';

export interface RemoteSource {
  sourceId: string;
  /** What the pill prints — the host. */
  label: string;
  client: WinnowClient;
  /** The instance's body cap, checked before a PUT; null when it declared none. */
  maxBytes: number | null;
}

export function isRemoteSource(sourceId: string): boolean {
  return sourceId !== DEFAULT_SOURCE_ID;
}

/**
 * The instance a source id names, ready to talk to — or null for `local`, for
 * a host this browser has not connected, and for one whose capabilities say
 * it has no document bucket (a push there would only 404).
 */
export function remoteFor(sourceId: string): RemoteSource | null {
  if (!isRemoteSource(sourceId)) return null;
  const conn = getWinnowConnection(sourceId);
  if (!conn || !conn.capabilities?.documents.bucket) return null;
  return {
    sourceId,
    label: conn.id,
    client: new WinnowClient({ baseUrl: conn.baseUrl, auth: conn.auth }),
    maxBytes: conn.capabilities.documents.maxBytes ?? null,
  };
}

export interface RemoteFailure {
  kind: PushFailure;
  message: string;
  theirs: TheirCopy | null;
}

/** Whatever the client threw, as the reducer's vocabulary plus a sentence. */
export function failureOf(err: unknown): RemoteFailure {
  if (err instanceof WinnowError) {
    const kind: PushFailure = err.kind === 'unreachable' ? 'unreachable' : err.kind;
    return { kind, message: err.message, theirs: err.theirs };
  }
  return { kind: 'protocol', message: err instanceof Error ? err.message : String(err), theirs: null };
}

/** One line a person can act on, with the sign-in link when that is the fix. */
export function explainFailure(
  failure: RemoteFailure,
  remote: RemoteSource,
): { text: string; login?: string } {
  if (failure.kind === 'unauthenticated') {
    return { text: `Not signed in to ${remote.label}.`, login: remote.client.loginUrl() };
  }
  if (failure.kind === 'unreachable') {
    return { text: `${remote.label} is unreachable — showing what this device holds.` };
  }
  return { text: failure.message };
}

export type PushOutcome = { ok: true; etag: string } | { ok: false; failure: RemoteFailure };

/**
 * One PUT of one document, guarded by the etag we hold. Never throws: the
 * outcome is what the reducer eats. A tool runs the reducer around this
 * itself, because an edit can land WHILE the request is out and only the
 * live record knows.
 */
export async function putDocOnce(
  remote: RemoteSource,
  kind: string,
  id: string,
  version: number,
  wireDoc: unknown,
  etag: string | null,
): Promise<PushOutcome> {
  try {
    const ack = await remote.client.putDoc(
      DOCS_APP,
      id,
      { kind, version, doc: wireDoc },
      etag,
      remote.maxBytes,
    );
    return { ok: true, etag: ack.etag };
  } catch (err) {
    return { ok: false, failure: failureOf(err) };
  }
}

/** The reducer event an outcome stands for. */
export function outcomeEvent(outcome: PushOutcome, now: number): SyncEvent {
  return outcome.ok
    ? { type: 'pushOk', etag: outcome.etag, now }
    : {
        type: 'pushFailed',
        kind: outcome.failure.kind,
        message: outcome.failure.message,
        theirs: outcome.failure.theirs ?? undefined,
      };
}

/** The reducer event a failed pull stands for — the same mapping as a push. */
export function failureEvent(failure: RemoteFailure): SyncEvent {
  return {
    type: 'pushFailed',
    kind: failure.kind,
    message: failure.message,
    theirs: failure.theirs ?? undefined,
  };
}
