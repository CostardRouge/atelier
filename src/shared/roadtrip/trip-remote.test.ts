import { describe, expect, it, vi } from 'vitest';
import { WinnowClient, WinnowError } from '../sources/winnow/client';
import { createTripDoc, TRIP_DOC_VERSION } from './trip-types';
import { newSyncRecord } from './trip-sync';
import {
  explainFailure,
  failureOf,
  fromWireDoc,
  isRemoteSource,
  listRemoteTrips,
  pullTrip,
  pushTrip,
  toWireDoc,
  type RemoteSource,
} from './trip-remote';

const HOST = 'winnow.example';
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

function remote(fetchImpl: FetchLike, maxBytes: number | null = null): RemoteSource {
  return {
    sourceId: HOST,
    label: HOST,
    client: new WinnowClient({ baseUrl: `https://${HOST}`, auth: { mode: 'cookie' } }, fetchImpl),
    maxBytes,
  };
}

const trip = () => createTripDoc('Australie', 'Australia', '2025-07-01', '2025-07-10', [], HOST);

describe('the wire shape', () => {
  it('sends everything but where the trip is kept', () => {
    const wire = toWireDoc(trip());
    expect(wire).not.toHaveProperty('sourceId');
    expect(wire.name).toBe('Australie');
  });

  it('stamps id and source from the request, never from the body', () => {
    const body = { ...toWireDoc(trip()), id: 'lying', sourceId: 'elsewhere' };
    const doc = fromWireDoc(body, 'real-id', HOST);
    expect(doc.id).toBe('real-id');
    expect(doc.sourceId).toBe(HOST);
  });

  it('migrates an older stored copy like an older stored trip', () => {
    // v6 → v7 is the step that fills `hookDefaults`.
    const body = { ...toWireDoc(trip()), version: 6 };
    delete (body as { hookDefaults?: unknown }).hookDefaults;
    const doc = fromWireDoc(body, 't1', HOST);
    expect(doc.version).toBe(TRIP_DOC_VERSION);
    expect(doc.hookDefaults).toEqual({});
  });

  it('refuses a body that is not a trip', () => {
    expect(() => fromWireDoc({ hello: 'world' }, 't1', HOST)).toThrow(/not a trip/);
    expect(() => fromWireDoc(null, 't1', HOST)).toThrow(/not a trip/);
  });

  it('knows local from remote', () => {
    expect(isRemoteSource('local')).toBe(false);
    expect(isRemoteSource(HOST)).toBe(true);
  });
});

describe('failureOf / explainFailure', () => {
  it('maps the client’s kinds onto the reducer’s, keeping the server’s copy on a conflict', () => {
    const err = new WinnowError('conflict', 'stale', 412, { etag: 'e9', updatedAt: null });
    expect(failureOf(err)).toEqual({ kind: 'conflict', message: 'stale', theirs: { etag: 'e9', updatedAt: null } });
    expect(failureOf(new WinnowError('notfound', 'gone', 404)).kind).toBe('notfound');
    expect(failureOf(new Error('boom'))).toMatchObject({ kind: 'protocol', message: 'boom' });
  });

  it('a lost session comes with the place to sign in', () => {
    const r = remote(async () => ok({}));
    const e = explainFailure({ kind: 'unauthenticated', message: 'x', theirs: null }, r);
    expect(e.text).toContain(HOST);
    expect(e.login).toBe(`https://${HOST}/login`);
  });

  it('unreachable says what is being shown instead', () => {
    const r = remote(async () => ok({}));
    expect(explainFailure({ kind: 'unreachable', message: 'x', theirs: null }, r).text).toMatch(/this device holds/);
  });
});

describe('pushTrip', () => {
  it('PUTs the wire doc under kind trip with the held etag, and lands synced on the new one', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ etag: 'e2', updated_at: 'x' }, { etag: 'e2' }));
    const doc = trip();
    const rec = await pushTrip(remote(fetchImpl), doc, { ...newSyncRecord(doc.id, HOST, 1), etag: 'e1' }, 5);
    expect(rec.status).toBe('synced');
    expect(rec.etag).toBe('e2');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe(`/api/apps/atelier/docs/${doc.id}`);
    expect(new Headers(init.headers).get('if-match')).toBe('e1');
    const body = JSON.parse(init.body as string);
    expect(body.kind).toBe('trip');
    expect(body.version).toBe(TRIP_DOC_VERSION);
    expect(body.doc).not.toHaveProperty('sourceId');
  });

  it('a first push has no record and no If-Match', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({ etag: 'e1', updated_at: 'x' }));
    const rec = await pushTrip(remote(fetchImpl), trip(), null, 5);
    expect(rec.status).toBe('synced');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('if-match')).toBe(false);
  });

  it('a 412 lands on conflict with the server’s copy, nothing thrown', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ error: 'stale', etag: 'e9', updated_at: '2026-09-06T14:02:00Z' }), { status: 412 });
    const rec = await pushTrip(remote(fetchImpl), trip(), null, 5);
    expect(rec.status).toBe('conflict');
    expect(rec.theirs).toEqual({ etag: 'e9', updatedAt: '2026-09-06T14:02:00Z' });
  });

  it('offline keeps the edit and says so', async () => {
    const rec = await pushTrip(remote(async () => { throw new TypeError('Failed to fetch'); }), trip(), null, 5);
    expect(rec.status).toBe('offline');
    expect(rec.dirtyAt).toBe(5);
  });

  it('refuses an oversize trip before sending, as a dirty record with the reason', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ok({}));
    const rec = await pushTrip(remote(fetchImpl, 64), trip(), null, 5);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rec.status).toBe('dirty');
    expect(rec.error).toMatch(/over the instance/);
  });
});

describe('pullTrip', () => {
  it('sends the held etag and reads a 304 as current', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 304 }));
    expect(await pullTrip(remote(fetchImpl), 't1', 'e1')).toEqual({ kind: 'current' });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('if-none-match')).toBe('e1');
  });

  it('fetches, stamps and migrates the server’s copy', async () => {
    const row = { id: 't1', kind: 'trip', version: 10, updated_at: 'u', etag: 'e2', doc: toWireDoc(trip()) };
    const r = await pullTrip(remote(async () => ok(row, { etag: 'e2' })), 't1', null);
    expect(r.kind).toBe('fetched');
    if (r.kind === 'fetched') {
      expect(r.doc.id).toBe('t1');
      expect(r.doc.sourceId).toBe(HOST);
      expect(r.etag).toBe('e2');
    }
  });

  it('never throws — a 404 is a failure the caller reads as gone', async () => {
    const r = await pullTrip(remote(async () => new Response('', { status: 404 })), 't1', null);
    expect(r).toMatchObject({ kind: 'failed', failure: { kind: 'notfound' } });
  });
});

describe('listRemoteTrips', () => {
  it('lists by kind and skips a row that is not a trip', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      ok({
        docs: [
          { id: 't1', kind: 'trip', version: 10, updated_at: 'u', etag: 'e1', doc: toWireDoc(trip()) },
          { id: 'junk', kind: 'trip', version: 10, updated_at: 'u', etag: 'e2', doc: { nope: 1 } },
        ],
      }),
    );
    const rows = await listRemoteTrips(remote(fetchImpl));
    expect(rows.map((r) => r.doc.id)).toEqual(['t1']);
    expect(rows[0].doc.sourceId).toBe(HOST);
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get('kind')).toBe('trip');
  });
});
