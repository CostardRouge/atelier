import { describe, expect, it } from 'vitest';
import { WinnowClient } from '../sources/winnow/client';
import type { RemoteSource } from '../sources/doc-remote';
import { fetchRemoteRoll, fitWireDoc, listRemoteRolls, pushOnce, toWireDoc } from './roll-remote';
import { rollSummary } from './roll-summary';
import { addPictures, createRollDoc, type JournalStep, type RollDoc } from './roll-types';

const HOST = 'winnow.example';
type Call = { url: string; init?: RequestInit };

function stub(answer: (url: string, init?: RequestInit) => unknown, summaries = true) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer(url, init)), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"e2"' },
    });
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

function heavyRoll(pictures: number, steps: number): RollDoc {
  const base = addPictures(
    createRollDoc('R', 'winnow', 1, 'r'),
    Array.from({ length: pictures }, (_, i) => ({ name: `p${i}.jpg`, size: 1, lastModified: 1 })),
    2,
  );
  const journal: JournalStep[] = Array.from({ length: steps }, (_, i) => ({
    at: i * 10_000,
    sections: ['develop'],
    after: { develop: { ...({} as object), exposure: i / 100 } as never },
  }));
  return { ...base, pictures: base.pictures.map((p) => ({ ...p, journal })) };
}

const size = (d: unknown) => new TextEncoder().encode(JSON.stringify(d)).byteLength;

describe('fitWireDoc', () => {
  it('leaves a roll under the cap alone', () => {
    const doc = heavyRoll(2, 5);
    expect(fitWireDoc(doc, 1024 * 1024).pictures[0].journal).toHaveLength(5);
    expect(fitWireDoc(doc, null).pictures[0].journal).toHaveLength(5);
  });

  it('thins the journals, never the pictures, until the roll fits', () => {
    const doc = heavyRoll(30, 300);
    const cap = 256 * 1024;
    expect(size(doc)).toBeGreaterThan(cap);
    const wire = fitWireDoc(doc, cap);
    expect(size(wire)).toBeLessThanOrEqual(cap);
    expect(wire.pictures).toHaveLength(30);
    expect(wire.pictures.map((p) => p.id)).toEqual(doc.pictures.map((p) => p.id));
  });

  it('does not touch the document it was given', () => {
    const doc = heavyRoll(30, 300);
    fitWireDoc(doc, 256 * 1024);
    expect(doc.pictures[0].journal).toHaveLength(300);
  });
});

describe('rolls listed by their summary', () => {
  const doc = { ...heavyRoll(3, 2), id: 'big', sourceId: HOST };

  it('pushes the summary beside the roll', async () => {
    const { remote, calls } = stub(() => ({ etag: 'e2', updated_at: 'now' }));
    expect((await pushOnce(remote, doc, null)).ok).toBe(true);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.summary).toEqual(rollSummary(doc));
    expect(body.doc.pictures).toHaveLength(3);
  });

  it('sends no summary to an instance that keeps none', async () => {
    const { remote, calls } = stub(() => ({ etag: 'e2', updated_at: 'now' }), false);
    await pushOnce(remote, doc, null);
    expect(JSON.parse(String(calls[0].init?.body))).not.toHaveProperty('summary');
  });

  it('lists a summary row as a partial card and a body row as a roll', async () => {
    const other = { ...heavyRoll(1, 0), id: 'old', sourceId: HOST };
    const { remote, calls } = stub(() => ({
      docs: [
        { id: 'big', kind: 'roll', version: 8, etag: 'e1', updated_at: 'u', summary: rollSummary(doc) },
        { id: 'old', kind: 'roll', version: 8, etag: 'e0', updated_at: 'u', doc: toWireDoc(other) },
        { id: 'junk', kind: 'roll', version: 8, etag: 'e9', updated_at: 'u', summary: { nope: true } },
      ],
    }));
    const rows = await listRemoteRolls(remote);
    expect(calls[0].url).toContain('fields=summary');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ partial: true, etag: 'e1', summary: { pictures: 3 } });
    expect(rows[0].doc).toMatchObject({ id: 'big', name: 'R', sourceId: HOST, pictures: [] });
    expect(rows[1].partial).toBeUndefined();
    expect(rows[1].doc.pictures).toHaveLength(1);
  });

  it('asks an older instance for the bodies, as before', async () => {
    const { remote, calls } = stub(() => ({ docs: [] }), false);
    await listRemoteRolls(remote);
    expect(calls[0].url).not.toContain('fields=');
  });

  it('fetches the whole roll a card stands for', async () => {
    const { remote } = stub(() => ({ id: 'big', kind: 'roll', version: 8, etag: 'e1', updated_at: 'u', doc: toWireDoc(doc) }));
    const got = await fetchRemoteRoll(remote, 'big');
    expect(got.etag).toBe('"e2"'); // the header as `pullRoll` hands it on; Winnow strips the quotes on If-Match
    expect(got.doc.pictures).toHaveLength(3);
    expect(got.doc.sourceId).toBe(HOST);
  });
});
