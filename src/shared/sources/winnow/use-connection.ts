import { useMemo, useSyncExternalStore } from 'react';
import { WinnowClient } from './client';
import {
  listWinnowConnections,
  subscribeWinnowConnections,
  type WinnowConnection,
} from './store';

/**
 * The connected Winnow the media surfaces talk to, and a client for it.
 *
 * Today that is the FIRST connection — the limitation every media surface
 * shares and records (`MEMORY.md`, open items): choosing between several
 * instances is one open item for all of them at once, and this hook is where
 * it will be answered once, rather than in each caller. Until then, one place
 * says "the first".
 */
export function useWinnowConnection(): {
  connection: WinnowConnection | null;
  client: WinnowClient | null;
} {
  const connections = useSyncExternalStore(subscribeWinnowConnections, listWinnowConnections);
  const connection = connections[0] ?? null;
  const client = useMemo(
    () =>
      connection
        ? new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth })
        : null,
    [connection],
  );
  return { connection, client };
}
