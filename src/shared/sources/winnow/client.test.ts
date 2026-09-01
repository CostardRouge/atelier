import { describe, expect, it, vi } from 'vitest';
import { WinnowClient, WinnowError, normalizeBaseUrl, sourceIdFor } from './client';

const BASE = 'https://winnow.example';
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return new WinnowClient({ baseUrl: BASE, auth: { mode: 'cookie' } }, fetchImpl);
}

describe('normalizeBaseUrl', () => {
  it('keeps the origin only, lowercased, no trailing slash', () => {
    expect(normalizeBaseUrl(' https://Winnow.Example/ ')).toBe('https://winnow.example');
  });
  it('refuses a path or a query — an instance is an origin', () => {
    expect(() => normalizeBaseUrl('https://winnow.example/library')).toThrow(/origin only/);
    expect(() => normalizeBaseUrl('https://winnow.example/?x=1')).toThrow(/origin only/);
  });
  it('refuses plain http except on localhost', () => {
    expect(() => normalizeBaseUrl('http://winnow.example')).toThrow(/https/);
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });
  it('names a source by its host', () => {
    expect(sourceIdFor('https://winnow.steeve.website')).toBe('winnow.steeve.website');
  });
});

describe('WinnowClient URLs', () => {
  const c = client(() => Promise.reject(new Error('unused')));
  it('builds the file routes Winnow actually serves', () => {
    expect(c.thumbUrl(12)).toBe(`${BASE}/api/assets/12/thumb`);
    expect(c.proxyUrl(12)).toBe(`${BASE}/api/assets/12/proxy`);
    expect(c.originalUrl(12)).toBe(`${BASE}/api/assets/12/download`);
    expect(c.sidecarUrl(7)).toBe(`${BASE}/api/sidecars/7/download`);
    expect(c.loginUrl()).toBe(`${BASE}/login`);
  });
  it('drops empty query values instead of sending "undefined"', () => {
    expect(c.url('/api/x', { a: 1, b: undefined, c: null, d: '' })).toBe(`${BASE}/api/x?a=1`);
  });
});

describe('WinnowClient requests', () => {
  it('sends the cookie same-site and asks for JSON', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ api: { version: 1 } }));
    await client(fetchImpl).capabilities();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/capabilities`);
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
  });

  it('sends a bearer token, and no cookie, in token mode', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({}));
    const c = new WinnowClient({ baseUrl: BASE, auth: { mode: 'token', token: 'abc' } }, fetchImpl);
    await c.capabilities();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('omit');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer abc');
  });

  it('asks the calendar and the day list the way Winnow filters', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ assets: [], next_cursor: null }));
    const c = client(fetchImpl);
    await c.calendar('2025-07-01', '2025-07-31');
    await c.assets({ dateFrom: '2025-07-09', dateTo: '2025-07-09', cursor: 'abc' });
    const urls = fetchImpl.mock.calls.map((call) => new URL(call[0]));
    expect(urls[0].pathname).toBe('/api/assets/calendar');
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({
      from: '2025-07-01',
      to: '2025-07-31',
      collapse: '1',
    });
    expect(urls[1].pathname).toBe('/api/assets');
    expect(Object.fromEntries(urls[1].searchParams)).toEqual({
      date_from: '2025-07-09',
      date_to: '2025-07-09',
      cursor: 'abc',
      limit: '200',
      collapse: '1',
      sort_dir: 'asc',
    });
  });

  it('carries the same filters to the calendar, the day and the sessions', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ assets: [], next_cursor: null, sessions: [] }));
    const c = client(fetchImpl);
    const filter = { mediaType: 'video' as const, ext: 'mp4', device: 'DJI Mini 4 Pro' };
    await c.calendar('2025-07-01', '2025-07-31', filter);
    await c.assets({ sessionId: 9, ...filter });
    await c.sessions(filter);
    const params = fetchImpl.mock.calls.map((call) => Object.fromEntries(new URL(call[0]).searchParams));
    for (const p of params) {
      expect(p).toMatchObject({ media_type: 'video', ext: 'mp4', device: 'DJI Mini 4 Pro' });
    }
    expect(params[1].session_id).toBe('9');
    expect(new URL(fetchImpl.mock.calls[2][0]).pathname).toBe('/api/sessions');
  });

  it('reads the facet slice it offers, tolerating a missing key', async () => {
    const c = client(async () => ok({ extensions: [{ value: 'hif', count: 3 }] }));
    expect(await c.facets()).toEqual({ media_types: [], extensions: [{ value: 'hif', count: 3 }], devices: [] });
  });

  it('follows next_cursor so a 300-media day is not shown two-thirds full', async () => {
    const pages: Record<string, unknown> = {
      '': { assets: [{ id: 1 }, { id: 2 }], next_cursor: 'p2' },
      p2: { assets: [{ id: 3 }], next_cursor: null },
    };
    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      ok(pages[new URL(url).searchParams.get('cursor') ?? '']),
    );
    const rows = await client(fetchImpl).allAssets({ dateFrom: '2025-07-09', dateTo: '2025-07-09' });
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops at the cap even when the server keeps offering a cursor', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ assets: [{ id: 1 }, { id: 2 }], next_cursor: 'more' }));
    const rows = await client(fetchImpl).allAssets({}, 3);
    expect(rows).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps 401 to unauthenticated — the user must sign in on the instance', async () => {
    const c = client(async () => new Response('', { status: 401 }));
    await expect(c.capabilities()).rejects.toMatchObject({ kind: 'unauthenticated', status: 401 });
  });

  it('maps 403 to forbidden and other failures to protocol', async () => {
    await expect(client(async () => new Response('', { status: 403 })).capabilities())
      .rejects.toMatchObject({ kind: 'forbidden' });
    await expect(client(async () => new Response('', { status: 500 })).capabilities())
      .rejects.toMatchObject({ kind: 'protocol', status: 500 });
  });

  it('maps a thrown fetch (CORS refusal, offline, bad host) to unreachable', async () => {
    const c = client(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await c.capabilities().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WinnowError);
    expect((err as WinnowError).kind).toBe('unreachable');
    expect((err as WinnowError).message).toContain(BASE);
  });

  it('rejects a 200 that is not JSON as a protocol error', async () => {
    const c = client(async () => new Response('<html>', { status: 200 }));
    await expect(c.capabilities()).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('turns a body into a File with the name, type and date it was told', async () => {
    const c = client(async () => new Response(new Uint8Array([1, 2, 3])));
    const file = await c.fetchFile(c.proxyUrl(1), 'DJI_0001.mp4', 'video/mp4', 1234);
    expect(file.name).toBe('DJI_0001.mp4');
    expect(file.type).toBe('video/mp4');
    expect(file.size).toBe(3);
    expect(file.lastModified).toBe(1234);
  });
});
