/**
 * Re-asking ONE instance what it can do, when its stored answer is the only
 * thing standing between a document and the screen.
 *
 * **The bug this exists for (2026-09-21).** A capabilities sheet is a SNAPSHOT
 * kept in `localStorage` per browser (`store.ts`). `documentSourcesFor(kind)`
 * keeps an instance only when that stored sheet says its bucket holds the kind
 * — and `bucketHolds` reads a sheet with no `kinds` list as trip + project
 * only. So a browser that connected before Winnow's bucket grew `roll` drops
 * the instance from the gallery ENTIRELY: no group, no request, no sentence.
 * The maintainer's report — a roll created on one machine never appearing on
 * the other, while the first machine showed it — is exactly that, and a reload
 * cannot cure it because the staleness is on this device.
 *
 * The cure already existed and was reachable from one screen only: `#/sources`
 * mounts `useSourceHealth`, whose probe IS the refresh. This module is the
 * same gesture, made available where the absence is actually noticed, and
 * governed by one rule: **it is asked only when the stored sheet cannot
 * explain an absence**, never on a healthy gallery. A sheet that already names
 * the kind costs nothing here.
 *
 * Once per instance per session — one probe replaces the WHOLE sheet, so a
 * second gallery asking about another kind has nothing left to learn, and an
 * instance that genuinely does not keep the kind is not asked again every time
 * a gallery is opened.
 */

import { WinnowClient } from './client';
import { putWinnowConnection, type WinnowConnection } from './store';

/** What came back — enough for a gallery to say something true. */
export type CapabilityProbe =
  /** The instance answered; its stored sheet is now what it says today. */
  | { state: 'read' }
  /** It would not say — offline, not signed in. The old sheet is kept. */
  | { state: 'refused'; problem: string };

const probes = new Map<string, Promise<CapabilityProbe>>();

/**
 * Ask `conn` what it can do and store the answer, at most once a session.
 * Never throws: a refusal is an outcome, and the caller keeps showing what
 * this device holds.
 */
export function refreshCapabilitiesOnce(conn: WinnowConnection): Promise<CapabilityProbe> {
  const held = probes.get(conn.id);
  if (held) return held;
  const client = new WinnowClient({ baseUrl: conn.baseUrl, auth: conn.auth });
  const probe = client.capabilities().then(
    (capabilities): CapabilityProbe => {
      // The store notifies, which is what makes every gallery re-decide
      // whether this instance can hold what it is listing.
      putWinnowConnection({ ...conn, capabilities, refreshedAt: Date.now() });
      return { state: 'read' };
    },
    (err: unknown): CapabilityProbe => ({
      state: 'refused',
      problem: err instanceof Error ? err.message : String(err),
    }),
  );
  probes.set(conn.id, probe);
  return probe;
}

/** Forget the probes — for tests, and for a connection that is re-made. */
export function forgetCapabilityProbes(): void {
  probes.clear();
}
