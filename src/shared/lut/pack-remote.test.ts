import { describe, expect, it } from 'vitest';
import { WinnowError, type WinnowClient } from '../sources/winnow/client';
import { buildPackIndex, type LutPackIndex } from './lut-pack';
import { PACK_KIND, deleteRemotePack, fetchRemotePacks, pushPack, type PackHost } from './pack-remote';

/**
 * A stand-in for the instance: it records the order of what it was asked to
 * do, which is the property that matters here — the bytes must be there
 * before the index that names them.
 */
function fakeHost(options: { has?: string[]; docs?: unknown[] } = {}) {
  const calls: string[] = [];
  const files = new Map<string, Uint8Array>();
  for (const hash of options.has ?? []) files.set(hash, new Uint8Array([1]));
  const docs = new Map<string, unknown>();

  const client = {
    async listAppFiles() {
      calls.push('list-files');
      return {
        files: [...files].map(([id, bytes]) => ({
          id,
          bytes: bytes.byteLength,
          mediaType: 'application/octet-stream',
          createdAt: '2026-09-20T00:00:00Z',
        })),
        used: 0,
        quota: null,
        maxBytes: null,
      };
    },
    async putAppFile(_app: string, hash: string, bytes: Uint8Array) {
      calls.push(`put-file:${hash}`);
      files.set(hash, bytes);
      return { created: true };
    },
    async getAppFile(_app: string, hash: string) {
      calls.push(`get-file:${hash}`);
      return files.get(hash) ?? null;
    },
    async deleteAppFile(_app: string, hash: string) {
      calls.push(`del-file:${hash}`);
      files.delete(hash);
    },
    async getDoc(_app: string, id: string) {
      calls.push(`get-doc:${id}`);
      const doc = docs.get(id);
      // What the real client throws for a row that is not there — which is
      // how a first push knows it is a create and sends no If-Match.
      if (!doc) throw new WinnowError('notfound', 'Not there.', 404);
      return { row: { id, kind: PACK_KIND, version: 1, updated_at: '', etag: 'e1', doc } };
    },
    async putDoc(_app: string, id: string, body: { doc: unknown }) {
      calls.push(`put-doc:${id}`);
      docs.set(id, body.doc);
      return { etag: 'e2', updatedAt: '' };
    },
    async deleteDoc(_app: string, id: string) {
      calls.push(`del-doc:${id}`);
      docs.delete(id);
    },
    async listDocs(_app: string, kind: string) {
      calls.push(`list-docs:${kind}`);
      return [...docs].map(([id, doc]) => ({
        id,
        kind,
        version: 1,
        updated_at: '',
        etag: 'e1',
        doc,
      }));
    },
  };

  const host: PackHost = {
    sourceId: 'winnow.example',
    client: client as unknown as WinnowClient,
    maxDocBytes: 1024 * 1024,
    maxFileBytes: 16 * 1024 * 1024,
  };
  return { host, calls, files, docs };
}

const pack = (hashes: string[]): LutPackIndex => {
  const index = buildPackIndex(
    hashes.map((hash, i) => ({ path: `Creative/Look ${i}.cube`, hash })),
    { id: 'pk_1', name: 'AUTHENTIC', author: 'Victor Jimenes' },
  );
  return index;
};

const lattices = (hashes: string[]) => async (hash: string) =>
  hashes.includes(hash) ? new Uint8Array([7, 7, 7]) : null;

describe('pushPack', () => {
  it('writes every lattice BEFORE the index that names them', async () => {
    const { host, calls } = fakeHost();
    await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    expect(calls.filter((c) => c.startsWith('put-file')).length).toBe(2);
    // The index is last: a device reading it must never find a look that 404s.
    expect(calls.at(-1)).toBe('put-doc:pk_1');
    expect(calls.indexOf('put-file:aa')).toBeLessThan(calls.indexOf('put-doc:pk_1'));
  });

  it('sends only what the instance is missing', async () => {
    const { host, calls } = fakeHost({ has: ['aa'] });
    const result = await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    expect(result).toMatchObject({ reused: 1, sent: 1 });
    expect(calls).not.toContain('put-file:aa');
    expect(calls).toContain('put-file:bb');
  });

  it('says which looks this device does not hold, and pushes the rest', async () => {
    const { host } = fakeHost();
    const result = await pushPack(host, pack(['aa', 'bb']), lattices(['aa']));
    expect(result.missingLocally).toEqual(['bb']);
    expect(result.sent).toBe(1);
  });

  it('pushes nothing twice when run again', async () => {
    const { host, calls } = fakeHost();
    const index = pack(['aa']);
    await pushPack(host, index, lattices(['aa']));
    calls.length = 0;
    const second = await pushPack(host, index, lattices(['aa']));
    expect(second).toMatchObject({ sent: 0, reused: 1 });
    expect(calls.filter((c) => c.startsWith('put-file'))).toEqual([]);
  });

  it('reports the bytes it wrote, not the bytes it named', async () => {
    const { host } = fakeHost({ has: ['aa'] });
    const result = await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    expect(result.bytes).toBe(3);
  });
});

describe('fetchRemotePacks', () => {
  it('reads back what was pushed, and refuses junk', async () => {
    const { host, docs } = fakeHost();
    await pushPack(host, pack(['aa']), lattices(['aa']));
    docs.set('junk', { not: 'a pack' });
    const back = await fetchRemotePacks(host);
    expect(back.map((p) => p.id)).toEqual(['pk_1']);
    expect(back[0].looks[0].hash).toBe('aa');
  });
});

describe('deleteRemotePack', () => {
  it('takes the index and the lattices no other pack names', async () => {
    const { host, files, docs } = fakeHost();
    const index = pack(['aa', 'bb']);
    await pushPack(host, index, lattices(['aa', 'bb']));
    await deleteRemotePack(host, index, new Set(['bb']));
    expect(docs.has('pk_1')).toBe(false);
    expect(files.has('aa')).toBe(false);
    // Another pack still names it: the bytes stay.
    expect(files.has('bb')).toBe(true);
  });
});
