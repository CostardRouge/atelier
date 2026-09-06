/**
 * Finding a document's media again, at the instance it came from.
 *
 * The asset library is a pool of `File`s in memory, and a reload empties it.
 * A file opened from a folder survives that — the document keeps a directory
 * handle and one permission click re-reads it — but a file FETCHED from a
 * Winnow does not: its bytes were never on this machine's disk, so a piece
 * whose picture came from an instance greeted every restart with "not in the
 * Library right now", and the day had to be found on the calendar and ticked
 * again.
 *
 * Remembering the bytes was weighed and declined. A cache of fetched proxies
 * would be the first place this suite persists media, against the standing
 * line in `local-first.md`, and it would be redundant: the document already
 * says where its bytes live. Since bridge phase 0 a `SavedMediaRef` carries
 * `assetId = "<host>/<id>"`, so the ref itself is the address — and asking
 * the instance for it again is one request against a host the user already
 * confirmed.
 *
 * The rules this keeps:
 *
 * - **Only a CONNECTED source.** A ref naming a host this browser has not
 *   allowed on `#/connect` resolves to null and the UI says so. A stored id
 *   must never become a reason to call a server nobody named.
 * - **Nothing at boot.** This runs when a piece is opened, never on load.
 * - **The proxy by default.** Preview reads the editing rendition (bridge
 *   §4.3); `materialize` re-registers the identity, so the file comes back
 *   vouched for with the ORIGINAL's hash and a fresh `fetchOriginal`, and the
 *   export can still deliver from the capture.
 * - **Local files are untouched.** A ref with no `assetId` — or one naming
 *   `local` — is not resolvable here and keeps resolving by hash and name
 *   exactly as it did. Folder media and instance media go on coexisting in
 *   one library; this only adds a way to re-find the half that has a home to
 *   be re-found from.
 */

import type { SavedMediaRef } from '../../projects/project-types';
import { DEFAULT_SOURCE_ID } from '../source';
import { WinnowClient } from './client';
// The same "<host>/<id>" the finals path splits to name a capture on its own
// instance — one reading of that id, not two.
import { splitAssetId } from './finals';
import { materialize, type Fidelity } from './materialize';
import { getWinnowConnection } from './store';

/** The connected instance `ref` names, or null when no connected one does. */
export function resolvableSource(ref: SavedMediaRef | null | undefined): string | null {
  const split = splitAssetId(ref?.assetId);
  if (!split || split.host === DEFAULT_SOURCE_ID) return null;
  return getWinnowConnection(split.host) ? split.host : null;
}

/** True when this browser can fetch `ref` again without asking anyone. */
export function isResolvable(ref: SavedMediaRef | null | undefined): boolean {
  return resolvableSource(ref) !== null;
}

export interface RefetchOptions {
  /** The edit rendition by default — preview always reads the proxy. */
  fidelity?: Fidelity;
  /** Called as each file lands, for a progress line. */
  onFile?: (done: number, total: number) => void;
}

/**
 * The files behind `ref`, fetched again from the instance holding them —
 * the clip or the still, plus its `.srt` when there is one, exactly as the
 * browser's own import would have brought them.
 *
 * Null means "nothing here can answer": the ref names no connected instance,
 * or the instance no longer has that asset (purged, or soft-deleted). An
 * instance that answers badly throws instead — a `WinnowError` the caller
 * states, because "not signed in" must not be reported as "gone".
 */
export async function refetchMedia(
  ref: SavedMediaRef | null | undefined,
  options: RefetchOptions = {},
): Promise<File[] | null> {
  const split = splitAssetId(ref?.assetId);
  if (!split) return null;
  const connection = getWinnowConnection(split.host);
  if (!connection) return null;
  const client = new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth });
  const row = await client.asset(split.id);
  if (!row) return null;
  return materialize(client, connection.id, row, {
    fidelity: options.fidelity ?? 'proxy',
    onFile: options.onFile ? (_file, i, n) => options.onFile?.(i, n) : undefined,
  });
}
