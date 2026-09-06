import { describe, expect, it, vi } from 'vitest';
import {
  WinnowClient,
  WinnowError,
  canWriteBack,
  chapterFromWire,
  hasTimeline,
  normalizeBaseUrl,
  sourceIdFor,
  type WinnowCapabilities,
  type WinnowChapter,
} from './client';
import type { TimelineChapter } from '../../roadtrip/timeline-import';

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
  it('keeps the first thumbnail request plain, so it stays cacheable', () => {
    expect(c.thumbRetryUrl(12, 0)).toBe(`${BASE}/api/assets/12/thumb`);
    expect(c.thumbRetryUrl(12, -1)).toBe(`${BASE}/api/assets/12/thumb`);
  });

  it('discriminates a RETRY, so a failed load is not answered from cache', () => {
    expect(c.thumbRetryUrl(12, 1)).toBe(`${BASE}/api/assets/12/thumb?retry=1`);
    expect(c.thumbRetryUrl(12, 3)).toBe(`${BASE}/api/assets/12/thumb?retry=3`);
  });

  it('drops empty query values instead of sending "undefined"', () => {
    expect(c.url('/api/x', { a: 1, b: undefined, c: null, d: '' })).toBe(`${BASE}/api/x?a=1`);
  });
});

describe('the timeline chapter, normalised at the boundary', () => {
  const wire = {
    id: 42,
    title: 'Kalbarri',
    start_date: '2025-11-05',
    end_date: '2025-11-08',
    revision: 7,
    asset_count: 120,
    photo_count: 100,
    video_count: 20,
    cover_id: 9001,
    places: [
      { name: 'Kalbarri', region: 'Western Australia', lat: -27.71, lon: 114.16 },
      { name: 'Nowhere', region: null, lat: null, lon: null },
      { region: 'no name' },
      'junk',
    ],
  };

  it('reads the assumed wire keys into Atelier\'s own shape', () => {
    expect(chapterFromWire(wire)).toEqual({
      id: '42',
      title: 'Kalbarri',
      startDate: '2025-11-05',
      endDate: '2025-11-08',
      places: [
        { name: 'Kalbarri', region: 'Western Australia', lat: -27.71, lon: 114.16 },
        { name: 'Nowhere', region: null, lat: null, lon: null },
      ],
      revision: '7',
      assetCount: 120,
      photoCount: 100,
      videoCount: 20,
      coverId: 9001,
    });
  });

  it('keeps an instant whole rather than slicing a day out of it — the import refuses it', () => {
    expect(chapterFromWire({ id: 1, start_date: '2026-02-11T23:00:00Z' })?.startDate).toBe(
      '2026-02-11T23:00:00Z',
    );
  });

  it('is null without an id, and empty-handed but sound with nothing else', () => {
    expect(chapterFromWire({ title: 'x' })).toBeNull();
    expect(chapterFromWire(null)).toBeNull();
    expect(chapterFromWire({ id: 'a' })).toEqual({
      id: 'a',
      title: null,
      startDate: null,
      endDate: null,
      places: [],
      revision: null,
      assetCount: 0,
      photoCount: null,
      videoCount: null,
      coverId: null,
    });
  });

  it('is what the Road Trip import takes, unchanged', () => {
    // Structural, not nominal: neither module imports the other.
    const chapter = chapterFromWire(wire) as WinnowChapter;
    const asImport: TimelineChapter = chapter;
    expect(asImport.id).toBe('42');
  });

  it('is offered only when the instance says it has a timeline', () => {
    const caps = (media: Record<string, unknown>) =>
      ({ media }) as unknown as WinnowCapabilities;
    expect(hasTimeline(caps({ timeline: true }))).toBe(true);
    expect(hasTimeline(caps({}))).toBe(false);
    expect(hasTimeline(null)).toBe(false);
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

  it('collapses an empty span to null — a filter matching nothing crashed the picker', async () => {
    // Winnow's min()/max() over no rows answer with a row of NULLs, so the
    // wire carries a bounds OBJECT with null fields. Left as-is it reached
    // monthKeyOf(null) during render and took the whole library down.
    const c = client(async () => ok({ days: [], bounds: { min: null, max: null } }));
    expect(await c.calendar('2026-09-01', '2026-09-30')).toEqual({ days: [], bounds: null });
  });

  it('keeps a real span, and survives a body missing days or bounds', async () => {
    const full = client(async () => ok({ days: [{ date: '2025-07-09', count: 3, cover_id: 1 }], bounds: { min: '2010-11-05', max: '2026-08-15' } }));
    expect(await full.calendar('2025-07-01', '2025-07-31')).toEqual({
      days: [{ date: '2025-07-09', count: 3, cover_id: 1 }],
      bounds: { min: '2010-11-05', max: '2026-08-15' },
    });
    const empty = client(async () => ok({}));
    expect(await empty.calendar('2025-07-01', '2025-07-31')).toEqual({ days: [], bounds: null });
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

  it("sends an explicit id set the way Winnow's intList reads it: comma-separated", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ assets: [], next_cursor: null }));
    await client(fetchImpl).assets({ ids: [42, 7] });
    const params = Object.fromEntries(new URL(fetchImpl.mock.calls[0][0]).searchParams);
    expect(params.ids).toBe('42,7');
    // An empty set sends nothing — `ids=` would be "match nothing" server-side.
    await client(fetchImpl).assets({ ids: [] });
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.has('ids')).toBe(false);
  });

  it('re-resolves a set of ids in the order asked, fetching a collapsed-away one on its own', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      const u = new URL(url);
      if (u.pathname === '/api/assets') return ok({ assets: [{ id: 7 }], next_cursor: null });
      if (u.pathname === '/api/assets/42') return ok({ asset: { id: 42 } });
      return new Response('', { status: 404 });
    });
    const rows = await client(fetchImpl).assetsByIds([42, 7, 99]);
    expect(rows.map((r) => r.id)).toEqual([42, 7]);
    const paths = fetchImpl.mock.calls.map((call) => new URL(call[0]).pathname);
    expect(paths).toEqual(['/api/assets', '/api/assets/42', '/api/assets/99']);
  });

  it('reads a single asset as { asset }, and a 404 as gone rather than an error', async () => {
    expect(await client(async () => ok({ asset: { id: 3 } })).asset(3)).toEqual({ id: 3 });
    expect(await client(async () => new Response('', { status: 404 })).asset(3)).toBeNull();
    await expect(
      client(async () => new Response('', { status: 500 })).asset(3),
    ).rejects.toMatchObject({ kind: 'protocol', status: 500 });
  });

  it('maps 401 to unauthenticated — the user must sign in on the instance', async () => {
    const c = client(async () => new Response('', { status: 401 }));
    await expect(c.capabilities()).rejects.toMatchObject({ kind: 'unauthenticated', status: 401 });
  });

  it('maps 403 to forbidden, 404 to notfound and other failures to protocol', async () => {
    await expect(client(async () => new Response('', { status: 403 })).capabilities())
      .rejects.toMatchObject({ kind: 'forbidden' });
    await expect(client(async () => new Response('', { status: 404 })).capabilities())
      .rejects.toMatchObject({ kind: 'notfound', status: 404 });
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

  describe('the document bucket', () => {
    const row = { id: 't1', kind: 'trip', version: 10, updated_at: '2026-09-06T10:00:00Z', etag: 'e1', doc: { name: 'A' } };

    it('lists one kind under the app namespace, with the cookie', async () => {
      const fetchImpl = vi.fn<FetchLike>(async () => ok({ docs: [row] }));
      const docs = await client(fetchImpl).listDocs('atelier', 'trip');
      expect(docs).toEqual([row]);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const u = new URL(url);
      expect(u.pathname).toBe('/api/apps/atelier/docs');
      expect(u.searchParams.get('kind')).toBe('trip');
      expect(init.credentials).toBe('include');
    });

    it('lists nothing when the body has no docs', async () => {
      expect(await client(async () => ok({})).listDocs('atelier', 'trip')).toEqual([]);
    });

    it('gets a row and trusts the ETag header over the body', async () => {
      const fetchImpl = vi.fn<FetchLike>(
        async () => new Response(JSON.stringify(row), { status: 200, headers: { etag: '"e2"' } }),
      );
      const r = await client(fetchImpl).getDoc('atelier', 't1', '"e1"');
      expect(r).toEqual({ row: { ...row, etag: '"e2"' } });
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).pathname).toBe('/api/apps/atelier/docs/t1');
      expect(new Headers(init.headers).get('if-none-match')).toBe('"e1"');
    });

    it('sends no If-None-Match when it holds no etag', async () => {
      const fetchImpl = vi.fn<FetchLike>(async () => ok(row));
      await client(fetchImpl).getDoc('atelier', 't1');
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(new Headers(init.headers).has('if-none-match')).toBe(false);
    });

    it('reads a 304 as "ours is current" — nothing downloaded', async () => {
      const c = client(async () => new Response(null, { status: 304 }));
      expect(await c.getDoc('atelier', 't1', 'e1')).toBe('not-modified');
    });

    it('a row that is not ours is notfound, never forbidden', async () => {
      const c = client(async () => new Response('{"error":"Not found"}', { status: 404 }));
      await expect(c.getDoc('atelier', 'someone-elses')).rejects.toMatchObject({ kind: 'notfound' });
    });

    it('PUTs JSON with If-Match and returns the acknowledged revision', async () => {
      const fetchImpl = vi.fn<FetchLike>(
        async () =>
          new Response(JSON.stringify({ etag: 'e2', updated_at: '2026-09-06T10:01:00Z' }), {
            status: 200,
            headers: { etag: 'e2' },
          }),
      );
      const r = await client(fetchImpl).putDoc('atelier', 't1', { kind: 'trip', version: 10, doc: { name: 'A' } }, 'e1');
      expect(r).toEqual({ etag: 'e2', updatedAt: '2026-09-06T10:01:00Z' });
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('PUT');
      const h = new Headers(init.headers);
      expect(h.get('if-match')).toBe('e1');
      expect(h.get('content-type')).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual({ kind: 'trip', version: 10, doc: { name: 'A' } });
    });

    it('a first push carries no If-Match — the server refuses if a row exists', async () => {
      const fetchImpl = vi.fn<FetchLike>(async () => ok({ etag: 'e1', updated_at: 'x' }));
      await client(fetchImpl).putDoc('atelier', 't1', { kind: 'trip', version: 10, doc: {} }, null);
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(new Headers(init.headers).has('if-match')).toBe(false);
    });

    it('maps a 412 to conflict, carrying the server’s revision', async () => {
      const c = client(
        async () =>
          new Response(JSON.stringify({ error: 'stale', etag: 'e9', updated_at: '2026-09-06T14:02:00Z' }), {
            status: 412,
          }),
      );
      const err = await c.putDoc('atelier', 't1', { kind: 'trip', version: 10, doc: {} }, 'e1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WinnowError);
      expect(err).toMatchObject({
        kind: 'conflict',
        status: 412,
        theirs: { etag: 'e9', updatedAt: '2026-09-06T14:02:00Z' },
      });
    });

    it('refuses an oversize body BEFORE any bytes travel', async () => {
      const fetchImpl = vi.fn<FetchLike>(async () => ok({}));
      const big = { kind: 'trip', version: 10, doc: { pad: 'x'.repeat(2000) } };
      await expect(client(fetchImpl).putDoc('atelier', 't1', big, null, 1024)).rejects.toMatchObject({
        kind: 'protocol',
        status: 413,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('maps the server’s own 413 to protocol', async () => {
      const c = client(async () => new Response('', { status: 413 }));
      await expect(c.putDoc('atelier', 't1', { kind: 'trip', version: 10, doc: {} }, null)).rejects.toMatchObject({
        kind: 'protocol',
        status: 413,
      });
    });

    it('a PUT acknowledged without an etag is a protocol error — nothing to guard the next write with', async () => {
      const c = client(async () => ok({ updated_at: 'x' }));
      await expect(c.putDoc('atelier', 't1', { kind: 'trip', version: 10, doc: {} }, null)).rejects.toMatchObject({
        kind: 'protocol',
      });
    });

    it('DELETEs with If-Match; a row already gone is notfound', async () => {
      const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
      await client(fetchImpl).deleteDoc('atelier', 't1', 'e1');
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('DELETE');
      expect(new URL(url).pathname).toBe('/api/apps/atelier/docs/t1');
      expect(new Headers(init.headers).get('if-match')).toBe('e1');
      const gone = client(async () => new Response('', { status: 404 }));
      await expect(gone.deleteDoc('atelier', 't1', 'e1')).rejects.toMatchObject({ kind: 'notfound' });
    });
  });

  it('asks the timeline under the same filters, and narrows a chapter\'s rows by it', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ chapters: [], assets: [], next_cursor: null }));
    const c = client(fetchImpl);
    await c.timeline({ mediaType: 'video' });
    await c.assets({ chapterId: '42', mediaType: 'video' });
    const urls = fetchImpl.mock.calls.map((call) => new URL(call[0]));
    expect(urls[0].pathname).toBe('/api/timeline');
    expect(Object.fromEntries(urls[0].searchParams)).toEqual({ media_type: 'video' });
    expect(Object.fromEntries(urls[1].searchParams)).toMatchObject({
      chapter_id: '42',
      media_type: 'video',
    });
  });

  it('drops a chapter it cannot read rather than half-showing it', async () => {
    const c = client(async () =>
      ok({ chapters: [{ id: 1, title: 'Perth' }, { title: 'no id' }, 'junk'] }),
    );
    const chapters = await c.timeline();
    expect(chapters.map((ch) => ch.id)).toEqual(['1']);
  });

  it('uploads finals as multipart files + parallel paths, with the capture id alongside', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ staged: 2 }));
    const c = client(fetchImpl);
    const a = new File([new Uint8Array(3)], 'a.mp4', { type: 'video/mp4' });
    const b = new File([new Uint8Array(4)], 'b.mp4', { type: 'video/mp4' });
    const answer = await c.upload(
      [{ file: a, path: '7/a.mp4' }, { file: b, path: '7/b.mp4' }],
      { originalAssetId: 42, chapterId: '7' },
    );
    expect(answer).toEqual({ staged: 2 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/upload`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const form = init.body as FormData;
    expect(form.getAll('files').map((f) => (f as File).name)).toEqual(['a.mp4', 'b.mp4']);
    expect(form.getAll('paths')).toEqual(['7/a.mp4', '7/b.mp4']);
    expect(form.get('original_asset_id')).toBe('42');
    expect(form.get('chapter_id')).toBe('7');
  });

  it('sends no capture id or chapter it does not have', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
    const c = client(fetchImpl);
    const answer = await c.upload([{ file: new File([], 'a.mp4'), path: 'a.mp4' }]);
    expect(answer).toBeNull();
    const form = (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.has('original_asset_id')).toBe(false);
    expect(form.has('chapter_id')).toBe(false);
  });

  it('reconciles with an empty JSON body', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ linked: 1 }));
    expect(await client(fetchImpl).reconcile()).toEqual({ linked: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/reconcile`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });

  it('knows a viewer cannot write back', () => {
    const caps = (role: string | null) =>
      ({ viewer: role ? { id: 1, username: 'x', role } : null }) as unknown as WinnowCapabilities;
    expect(canWriteBack(caps('admin'))).toBe(true);
    expect(canWriteBack(caps('editor'))).toBe(true);
    expect(canWriteBack(caps('viewer'))).toBe(false);
    expect(canWriteBack(caps(null))).toBe(false);
    expect(canWriteBack(null)).toBe(false);
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
