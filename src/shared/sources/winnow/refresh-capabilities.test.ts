import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetCapabilityProbes, refreshCapabilitiesOnce } from './refresh-capabilities';
import {
  getWinnowConnection,
  putWinnowConnection,
  resetWinnowConnectionsForTests,
  type WinnowConnection,
} from './store';
import type { WinnowCapabilities } from './client';

const HOST = 'winnow.example';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

/** A sheet from before the bucket knew about rolls — the bug's own shape. */
const stale = {
  api: { version: 1 },
  auth: { methods: ['cookie'], corsEnabled: true },
  media: { sidecars: true, rangeOnDerivatives: true },
  documents: { bucket: true, kinds: ['trip', 'project'] },
  scheduling: { reminders: false },
} as unknown as WinnowCapabilities;

const fresh = {
  ...stale,
  documents: { bucket: true, kinds: ['trip', 'project', 'roll', 'presets'] },
} as unknown as WinnowCapabilities;

const conn = (): WinnowConnection => ({
  id: HOST,
  baseUrl: `https://${HOST}`,
  auth: { mode: 'cookie' },
  capabilities: stale,
  connectedAt: 1000,
});

describe('re-asking an instance what it keeps', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    resetWinnowConnectionsForTests();
    forgetCapabilityProbes();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    resetWinnowConnectionsForTests();
    forgetCapabilityProbes();
    vi.unstubAllGlobals();
  });

  it('replaces the stored sheet, which is what makes the kind appear', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(fresh), { headers: { 'content-type': 'application/json' } })),
      ),
    );
    putWinnowConnection(conn());
    expect(getWinnowConnection(HOST)?.capabilities?.documents.kinds).toEqual(['trip', 'project']);

    expect(await refreshCapabilitiesOnce(conn())).toEqual({ state: 'read' });
    expect(getWinnowConnection(HOST)?.capabilities?.documents.kinds).toContain('roll');
    expect(getWinnowConnection(HOST)?.refreshedAt).toBeGreaterThan(0);
  });

  it('asks once a session, however many galleries notice the absence', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(fresh), { headers: { 'content-type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetchImpl);
    putWinnowConnection(conn());
    const answers = await Promise.all([
      refreshCapabilitiesOnce(conn()),
      refreshCapabilitiesOnce(conn()),
      refreshCapabilitiesOnce(conn()),
    ]);
    expect(answers).toEqual([{ state: 'read' }, { state: 'read' }, { state: 'read' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // And not again after it has settled, even for a kind it still lacks.
    expect(await refreshCapabilitiesOnce(conn())).toEqual({ state: 'read' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the old sheet when the instance will not say, and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    putWinnowConnection(conn());
    const probe = await refreshCapabilitiesOnce(conn());
    expect(probe.state).toBe('refused');
    expect(probe).toHaveProperty('problem');
    expect(getWinnowConnection(HOST)?.capabilities?.documents.kinds).toEqual(['trip', 'project']);
  });

  it('is never asked on its own — only a caller that noticed an absence asks', () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    putWinnowConnection(conn());
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
