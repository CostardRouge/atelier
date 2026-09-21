import { describe, expect, it } from 'vitest';
import { WinnowError, type WinnowClient } from '../sources/winnow/client';
import { buildPackIndex, withoutLooks, type LutPackIndex } from './lut-pack';
import { sha256Hex } from './pack-codec';
import {
  PACK_KIND,
  deleteRemoteLooks,
  deleteRemotePack,
  fetchRemotePacks,
  pushPack,
  type PackHost,
} from './pack-remote';

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
    // The real route hashes the body and refuses a path that disagrees
    // (`docs/lut-packs.md` §4.4) — a 400 reading "the body does not hash to
    // that id", which is what every push answered until the id stopped being
    // the source file's hash. The stub refuses the same way, so the property
    // is held here and not only in a browser against a real instance.
    async putAppFile(_app: string, id: string, bytes: Uint8Array) {
      calls.push(`put-file:${id}`);
      if ((await sha256Hex(bytes)) !== id) {
        throw new WinnowError('protocol', 'the body does not hash to that id', 400);
      }
      files.set(id, bytes);
      return { created: true };
    },
    async getAppFile(_app: string, id: string) {
      calls.push(`get-file:${id}`);
      return files.get(id) ?? null;
    },
    async deleteAppFile(_app: string, id: string) {
      calls.push(`del-file:${id}`);
      files.delete(id);
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

/**
 * A look's bytes as the vault holds them: the ENCODED lattice, whose hash is
 * not the `.cube`'s. Distinct per look, so a test can tell the id the push
 * writes under from the look's own hash — the whole of the bug.
 */
const bytesFor = (hash: string) => new TextEncoder().encode(`lattice:${hash}`);
/** What the instance must end up calling that look's bytes. */
const blobOf = (hash: string) => sha256Hex(bytesFor(hash));

const lattices = (hashes: string[]) => async (hash: string) =>
  hashes.includes(hash) ? bytesFor(hash) : null;

describe('pushPack', () => {
  it('writes every lattice BEFORE the index that names them', async () => {
    const { host, calls } = fakeHost();
    await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    expect(calls.filter((c) => c.startsWith('put-file')).length).toBe(2);
    // The index is last: a device reading it must never find a look that 404s.
    expect(calls.at(-1)).toBe('put-doc:pk_1');
    expect(calls.indexOf(`put-file:${await blobOf('aa')}`)).toBeLessThan(
      calls.indexOf('put-doc:pk_1'),
    );
  });

  it('stores each lattice under the hash of the bytes it sends', async () => {
    const { host, files } = fakeHost();
    await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    // The regression: the id was the SOURCE file's hash while the body is the
    // encoded lattice, so the instance refused every upload with a 400.
    expect([...files.keys()].sort()).toEqual([await blobOf('aa'), await blobOf('bb')].sort());
    for (const [id, bytes] of files) expect(await sha256Hex(bytes)).toBe(id);
  });

  it('names those blobs in the index it pushes, beside the source hashes', async () => {
    const { host, docs } = fakeHost();
    const result = await pushPack(host, pack(['aa']), lattices(['aa']));
    const look = result.index.looks[0];
    expect(look).toMatchObject({ hash: 'aa', blob: await blobOf('aa') });
    // And another device reads it from the instance, not from this one.
    expect((docs.get('pk_1') as LutPackIndex).looks[0].blob).toBe(await blobOf('aa'));
  });

  it('sends only what the instance is missing', async () => {
    const { host, calls } = fakeHost({ has: [await blobOf('aa')] });
    const result = await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    expect(result).toMatchObject({ reused: 1, sent: 1 });
    expect(calls).not.toContain(`put-file:${await blobOf('aa')}`);
    expect(calls).toContain(`put-file:${await blobOf('bb')}`);
  });

  it('writes one file for two looks that hold the same lattice', async () => {
    const { host, files } = fakeHost();
    const same = async () => new Uint8Array([7, 7, 7]);
    const result = await pushPack(host, pack(['aa', 'bb']), same);
    expect(result.sent).toBe(1);
    expect(files.size).toBe(1);
    const blob = await sha256Hex(new Uint8Array([7, 7, 7]));
    expect(result.index.looks.map((l) => l.blob)).toEqual([blob, blob]);
  });

  it('says which looks this device does not hold, and pushes the rest', async () => {
    const { host } = fakeHost();
    const result = await pushPack(host, pack(['aa', 'bb']), lattices(['aa']));
    expect(result.missingLocally).toEqual(['bb']);
    expect(result.sent).toBe(1);
  });

  it('pushes nothing twice, and reads nothing back out of the vault to find out', async () => {
    const { host, calls } = fakeHost();
    const asked: string[] = [];
    const read = async (hash: string) => {
      asked.push(hash);
      return bytesFor(hash);
    };
    const first = await pushPack(host, pack(['aa']), read);
    calls.length = 0;
    asked.length = 0;
    // The index the first push RETURNED is what the vault keeps: it carries
    // the blob, so the second push answers from the listing alone rather than
    // reading 40 MB of lattices back out to hash them again.
    const second = await pushPack(host, first.index, read);
    expect(second).toMatchObject({ sent: 0, reused: 1 });
    expect(asked).toEqual([]);
    expect(calls.filter((c) => c.startsWith('put-file'))).toEqual([]);
  });

  it('reports the bytes it wrote, not the bytes it named', async () => {
    const { host } = fakeHost({ has: [await blobOf('aa')] });
    const result = await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    expect(result.bytes).toBe(bytesFor('bb').byteLength);
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
    // The blob survives the read too, or the device that adopts the pack has
    // no id to fetch the lattice under.
    expect(back[0].looks[0].blob).toBe(await blobOf('aa'));
  });
});

describe('deleteRemotePack', () => {
  it('takes the index and the lattices no other pack names', async () => {
    const { host, files, docs } = fakeHost();
    const { index } = await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    await deleteRemotePack(host, index, new Set([await blobOf('bb')]));
    expect(docs.has('pk_1')).toBe(false);
    expect(files.has(await blobOf('aa'))).toBe(false);
    // Another pack still names it: the bytes stay.
    expect(files.has(await blobOf('bb'))).toBe(true);
  });

  it('takes the index FIRST — the exact mirror of a push', async () => {
    const { host, calls } = fakeHost();
    const { index } = await pushPack(host, pack(['aa']), lattices(['aa']));
    calls.length = 0;
    await deleteRemotePack(host, index, new Set());
    // An index that still named a gone lattice would 404 on every picture;
    // one that has dropped a look whose bytes linger only wastes space.
    expect(calls.indexOf('del-doc:pk_1')).toBeLessThan(
      calls.indexOf(`del-file:${await blobOf('aa')}`),
    );
  });
});

describe('deleteRemoteLooks', () => {
  it('writes the index without the look, then frees its lattice', async () => {
    const { host, files, docs, calls } = fakeHost();
    const { index } = await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    const kept = index.looks[1];
    const next = withoutLooks(index, [index.looks[0].id]);
    calls.length = 0;
    await deleteRemoteLooks(host, next, [await blobOf('aa')]);

    // The pack is still there, one look lighter, and the surviving look's
    // bytes are untouched.
    expect((docs.get('pk_1') as LutPackIndex).looks.map((l) => l.id)).toEqual([kept.id]);
    expect(files.has(await blobOf('aa'))).toBe(false);
    expect(files.has(await blobOf('bb'))).toBe(true);
    expect(calls.indexOf('put-doc:pk_1')).toBeLessThan(
      calls.indexOf(`del-file:${await blobOf('aa')}`),
    );
  });

  it('frees nothing the caller did not name', async () => {
    const { host, files } = fakeHost();
    const { index } = await pushPack(host, pack(['aa', 'bb']), lattices(['aa', 'bb']));
    // A look dropped whose lattice another look shares: the index changes and
    // no byte moves.
    await deleteRemoteLooks(host, withoutLooks(index, [index.looks[0].id]), []);
    expect(files.size).toBe(2);
  });
});
