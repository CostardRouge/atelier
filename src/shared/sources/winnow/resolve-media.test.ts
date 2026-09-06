import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isResolvable, refetchMedia, resolvableSource } from './resolve-media';
import {
  putWinnowConnection,
  resetWinnowConnectionsForTests,
  type WinnowConnection,
} from './store';
import { knownIdentity, mediaHash, mediaOrigin } from '../../projects/media-identity';
import type { SavedMediaRef } from '../../projects/project-types';

const HOST = 'winnow.example';

const conn = (id = HOST): WinnowConnection => ({
  id,
  baseUrl: `https://${id}`,
  auth: { mode: 'cookie' },
  capabilities: null,
  connectedAt: 1000,
});

const ref = (over: Partial<SavedMediaRef> = {}): SavedMediaRef => ({
  name: 'DJI_0001.mp4',
  size: 10,
  lastModified: 0,
  assetId: `${HOST}/42`,
  hash: 'abc123',
  ...over,
});

const row = {
  id: 42,
  filename: 'DJI_0001.MP4',
  ext: 'mp4',
  media_type: 'video',
  captured_at: '2025-07-09T08:30:00.000Z',
  capture_date: '2025-07-09',
  width: 3840,
  height: 2160,
  duration_s: 12,
  file_size: 500_000_000,
  content_hash: 'abc123',
  gps_lat: null,
  gps_lon: null,
  camera_model: 'DJI Mini 4 Pro',
  iso: null,
  shutter: null,
  aperture: null,
  focal_length: null,
  relative_altitude: null,
  absolute_altitude: null,
  derivative_status: 'ready',
  has_telemetry: true,
  sidecars: [{ id: 7, kind: 'srt', filename: 'DJI_0001.SRT' }],
};

/** A Storage stand-in: node has no localStorage. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

/** Answers the detail route and the two file routes, nothing else. */
function serving(overrides: Record<string, Response> = {}) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (overrides[path]) return overrides[path].clone();
    if (path === '/api/assets/42') {
      return new Response(JSON.stringify({ asset: row }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/api/assets/42/proxy') return new Response(new Uint8Array(10));
    if (path === '/api/sidecars/7/download') return new Response(new Uint8Array(3));
    return new Response('', { status: 404 });
  });
}

describe('resolving a document ref back to its instance', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    resetWinnowConnectionsForTests();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    resetWinnowConnectionsForTests();
    vi.unstubAllGlobals();
  });

  it('names the instance only once it has actually been connected', () => {
    expect(resolvableSource(ref())).toBeNull();
    putWinnowConnection(conn());
    expect(resolvableSource(ref())).toBe(HOST);
    expect(isResolvable(ref())).toBe(true);
  });

  it('never claims a local file, a bare name or a malformed id', () => {
    putWinnowConnection(conn());
    for (const bad of [
      ref({ assetId: undefined }),
      ref({ assetId: 'local/42' }),
      ref({ assetId: '42' }),
      ref({ assetId: `${HOST}/abc` }),
      null,
    ]) {
      expect(isResolvable(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a host that is not connected — a stored id is not a licence to call one', async () => {
    const fetchImpl = serving();
    vi.stubGlobal('fetch', fetchImpl);
    putWinnowConnection(conn('other.example'));
    expect(await refetchMedia(ref())).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('brings the clip and its log back, vouched with the ORIGINAL hash', async () => {
    vi.stubGlobal('fetch', serving());
    putWinnowConnection(conn());
    const seen: number[] = [];
    const files = await refetchMedia(ref(), { onFile: (done) => seen.push(done) });
    expect(files?.map((f) => f.name)).toEqual(['DJI_0001.mp4', 'DJI_0001.SRT']);
    expect(seen).toEqual([1, 2]);
    // The proxy's own bytes are nobody's identity: the document must find it
    // by the same assetId and hash it was saved with.
    expect(knownIdentity(files![0])).toMatchObject({ assetId: `${HOST}/42`, hash: 'abc123' });
    expect(await mediaHash(files![0])).toBe('abc123');
    // And the export can still go and get the capture.
    expect(mediaOrigin(files![0])).toMatchObject({ sourceId: HOST, fidelity: 'proxy' });
    expect(typeof mediaOrigin(files![0])?.fetchOriginal).toBe('function');
  });

  it('reads an asset the instance no longer has as gone, not as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      serving({ '/api/assets/42': new Response('', { status: 404 }) }),
    );
    putWinnowConnection(conn());
    expect(await refetchMedia(ref())).toBeNull();
  });

  it('lets "sign in there" reach the caller instead of reporting it as gone', async () => {
    vi.stubGlobal(
      'fetch',
      serving({ '/api/assets/42': new Response('', { status: 401 }) }),
    );
    putWinnowConnection(conn());
    await expect(refetchMedia(ref())).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
});
