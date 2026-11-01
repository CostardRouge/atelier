import { describe, expect, it } from 'vitest';
import { WinnowClient } from '../../shared/sources/winnow/client';
import type { RemoteSource } from '../../shared/sources/doc-remote';
import { MOSAIC_DOC_VERSION, createMosaicDoc, withTiles, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import { mosaicSummary } from '../../shared/mosaic/mosaic-summary';
import { MOSAIC_DOC_KIND, fetchRemoteMosaic, fromWireDoc, listRemoteMosaics, pushOnce, toWireDoc } from './mosaic-remote';

const HOST = 'winnow.example';
type Call = { url: string; init?: RequestInit };

function stub(answer: (url: string, init?: RequestInit) => unknown, summaries = true) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer(url, init)), { status: 200, headers: { 'content-type': 'application/json', etag: '"e2"' } });
  };
  const remote: RemoteSource = {
    sourceId: HOST,
    label: HOST,
    client: new WinnowClient({ baseUrl: `https://${HOST}`, auth: { mode: 'cookie' } }, fetchImpl),
    maxBytes: null,
    summaries,
  };
  return { remote, calls };
}

const GRID = 'A'.repeat(144);

function mosaic(id = 'm1'): MosaicDoc {
  const doc = { ...createMosaicDoc('Iceland', HOST, 1_000), id };
  return {
    ...withTiles(doc, [
      { id: 101, kind: 'photo', grid: GRID },
      { id: 102, kind: 'photo', grid: GRID },
      { id: 103, kind: 'clip' },
    ]),
    instance: HOST,
    target: 101,
  };
}

describe('a mosaic on the wire', () => {
  it('travels without where it is kept, and comes back stamped from the request', () => {
    const doc = mosaic();
    const wire = toWireDoc(doc);
    expect(wire).not.toHaveProperty('sourceId');
    expect(doc.sourceId).toBe(HOST); // the document given is left alone
    const back = fromWireDoc(JSON.parse(JSON.stringify(wire)), 'm1', 'other.example');
    expect(back).toMatchObject({ id: 'm1', sourceId: 'other.example', instance: HOST, target: 101, title: 'Iceland' });
    expect(back.tiles.map((t) => t.id)).toEqual([101, 102, 103]);
  });

  it('refuses a body that is not a mosaic, or one from a newer version', () => {
    expect(() => fromWireDoc([], 'x', HOST)).toThrow(/not a mosaic/);
    expect(() => fromWireDoc({ ...toWireDoc(mosaic()), version: MOSAIC_DOC_VERSION + 1 }, 'x', HOST)).toThrow(/not a mosaic/);
  });

  it('pushes under its kind, its summary beside it', async () => {
    const { remote, calls } = stub(() => ({ etag: 'e2', updated_at: 'now' }));
    const doc = mosaic();
    expect((await pushOnce(remote, doc, null)).ok).toBe(true);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.kind).toBe(MOSAIC_DOC_KIND);
    expect(body.summary).toEqual(mosaicSummary(doc));
    expect(body.doc.tiles).toHaveLength(3);
  });

  it('sends no summary to an instance that keeps none', async () => {
    const { remote, calls } = stub(() => ({ etag: 'e2', updated_at: 'now' }), false);
    await pushOnce(remote, mosaic(), null);
    expect(JSON.parse(String(calls[0].init?.body))).not.toHaveProperty('summary');
  });

  it('lists a summary row as a partial card and a body row as a mosaic, skipping what is neither', async () => {
    const { remote, calls } = stub(() => ({
      docs: [
        { id: 'big', kind: 'mosaic', version: 3, etag: 'e1', updated_at: 'u', summary: mosaicSummary(mosaic('big')) },
        { id: 'old', kind: 'mosaic', version: 3, etag: 'e0', updated_at: 'u', doc: toWireDoc(mosaic('old')) },
        { id: 'junk', kind: 'mosaic', version: 3, etag: 'e9', updated_at: 'u', summary: { nope: true } },
      ],
    }));
    const rows = await listRemoteMosaics(remote);
    expect(calls[0].url).toContain('fields=summary');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ partial: true, etag: 'e1', summary: { pictures: 3, measured: 2 } });
    expect(rows[0].doc).toMatchObject({ id: 'big', title: 'Iceland', sourceId: HOST, tiles: [] });
    expect(rows[1].partial).toBeUndefined();
    expect(rows[1].doc.tiles).toHaveLength(3);
  });

  it('asks an older instance for the bodies, and fetches the whole mosaic a card stands for', async () => {
    const older = stub(() => ({ docs: [] }), false);
    await listRemoteMosaics(older.remote);
    expect(older.calls[0].url).not.toContain('fields=');
    const { remote } = stub(() => ({ id: 'big', kind: 'mosaic', version: 3, etag: 'e1', updated_at: 'u', doc: toWireDoc(mosaic('big')) }));
    const got = await fetchRemoteMosaic(remote, 'big');
    expect(got.doc.tiles).toHaveLength(3);
    expect(got.doc.sourceId).toBe(HOST);
  });
});
