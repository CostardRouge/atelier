import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHECKING,
  healthFromAnswer,
  healthFromError,
  type SourceHealth,
} from '../source-ledger';
import { WinnowClient } from './client';
import { putWinnowConnection, type WinnowConnection } from './store';

/**
 * Asks each connected instance where it stands — and, in the same breath,
 * refreshes the capabilities sheet it answered with.
 *
 * **The probe IS the refresh.** A sheet read at connect time goes stale
 * silently: a browser that connected before an instance grew its document
 * bucket keeps hiding trip persistence with no visible reason and no obvious
 * cure (`MEMORY.md`, open items — it cost a real debugging session). So a
 * successful `/api/capabilities` is stored back on the connection with a
 * `refreshedAt` stamp, and the screen that shows the answer also fixes the
 * cause.
 *
 * **Nothing here runs at boot.** The hook is mounted by the sources screen,
 * which a person navigated to — the same rule the connect flow has always
 * followed: Atelier never calls a server the user did not name, and never
 * because the app started.
 *
 * One probe per connection per mount; `check(id)` re-runs one on demand
 * (Retry, Refresh, after signing in on the instance).
 */
export function useSourceHealth(connections: readonly WinnowConnection[]): {
  health: Map<string, SourceHealth>;
  check: (id: string) => void;
} {
  const [health, setHealth] = useState<Map<string, SourceHealth>>(new Map());
  // The connections as of this render, without making them a probe trigger:
  // a successful probe writes to the store, which hands back a new array, and
  // an effect keyed on the array itself would probe forever.
  const latest = useRef<readonly WinnowConnection[]>(connections);
  latest.current = connections;
  const started = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const check = useCallback((id: string) => {
    const conn = latest.current.find((c) => c.id === id);
    if (!conn) return;
    started.current.add(id);
    setHealth((prev) => new Map(prev).set(id, CHECKING));
    const client = new WinnowClient({ baseUrl: conn.baseUrl, auth: conn.auth });
    const at = Date.now();
    void client
      .capabilities()
      .then((capabilities) => {
        // The answer replaces the stored sheet: what the instance says now is
        // what every surface should be reading.
        putWinnowConnection({ ...conn, capabilities, refreshedAt: Date.now() });
        if (alive.current) {
          setHealth((prev) => new Map(prev).set(id, healthFromAnswer(Date.now() - at)));
        }
      })
      .catch((err: unknown) => {
        if (alive.current) {
          setHealth((prev) => new Map(prev).set(id, healthFromError(err, conn.id)));
        }
      });
  }, []);

  // A string key, so the effect re-runs when the SET of ids changes and not
  // when the store hands back a fresh array holding the same ones. A host
  // cannot contain '|', so the join is unambiguous.
  const ids = connections.map((c) => c.id).join('|');
  useEffect(() => {
    for (const id of ids ? ids.split('|') : []) {
      if (!started.current.has(id)) check(id);
    }
  }, [ids, check]);

  return { health, check };
}
