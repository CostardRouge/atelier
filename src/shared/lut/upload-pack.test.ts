import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodedBytes } from './pack-codec';

/**
 * The vault's two halves are IndexedDB and a canvas, neither of which exists
 * in a node run, so they are stood in for. What is being checked is not the
 * storage — `pack-store` has its own tests — but the three claims step 7
 * rests on (`docs/lut-packs.md` §3.1):
 *
 * 1. the LATTICE goes to the vault, keyed by the file's SHA-256;
 * 2. what comes back for the document is a REFERENCE of a couple of hundred
 *    bytes, holding no lattice;
 * 3. the same file uploaded twice is one look, matched on the hash.
 */
const stored = new Map<string, Uint8Array>();
let saved: unknown[] = [];

vi.mock('./pack-store', () => ({
  storedLatticeHashes: async () => new Set(stored.keys()),
}));

vi.mock('./pack-thumbs', () => ({
  // A canvas is what bakes one; its absence is a missing thumbnail, never a
  // failed import (`pack-thumbs.ts` makes the same choice).
  bakeLookThumb: async () => null,
}));

vi.mock('./pack-vault', () => ({
  loadPacks: async () => [],
  packsSnapshot: () => saved.at(-1) ? [saved.at(-1)] : [],
  savePack: async (index: unknown) => {
    saved.push(index);
    return true;
  },
  saveLookLattice: async (_packId: string, hash: string, bytes: Uint8Array) => {
    stored.set(hash, bytes);
    return true;
  },
}));

const { UPLOAD_PACK_ID, uploadLookIntoVault, uploadedLabel } = await import('./upload-pack');

/** A minimal but real 3D `.cube`: identity at grid size 2. */
const IDENTITY_CUBE = [
  'LUT_3D_SIZE 2',
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\n');

function cubeFile(name: string, text = IDENTITY_CUBE): File {
  return new File([text], name, { type: 'text/plain' });
}

describe('uploading a .cube into the vault', () => {
  beforeEach(() => {
    stored.clear();
    saved = [];
  });

  it('stores the lattice and answers a reference, not a lattice', async () => {
    const result = await uploadLookIntoVault(cubeFile('My Teal Grade.cube'));

    // The bytes went to the vault, keyed by the file's own hash.
    expect(stored.size).toBe(1);
    expect(result.ref.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.get(result.ref.hash)?.byteLength).toBe(encodedBytes(2));

    // What a document would store: three short strings, no lattice anywhere.
    expect(result.ref.pack).toBe(UPLOAD_PACK_ID);
    expect(result.ref.look).toBe('my-teal-grade');
    expect(JSON.stringify(result.ref).length).toBeLessThan(200);
    expect(JSON.stringify(result.ref)).not.toContain('LUT_3D_SIZE');

    // And the caller can grade at once, without a round trip through storage.
    expect(result.lut.size).toBe(2);
    expect(result.name).toBe('My Teal Grade');
  });

  it('files the look in the one personal pack, at its root', async () => {
    await uploadLookIntoVault(cubeFile('Sunset.cube'));
    const index = saved.at(-1) as { id: string; looks: { node: string; family: string }[] };
    expect(index.id).toBe(UPLOAD_PACK_ID);
    expect(index.looks).toHaveLength(1);
    expect(index.looks[0].node).toBe('');
    // No category above it, so the reference is read from the NAME (§7).
    expect(index.looks[0].family).toBe('rec709');
  });

  it('reads a conversion look on the log reference', async () => {
    await uploadLookIntoVault(cubeFile('DJI D-Log M to Rec709.cube'));
    const index = saved.at(-1) as { looks: { family: string }[] };
    expect(index.looks[0].family).toBe('log');
  });

  it('recognises the same bytes again rather than storing them twice', async () => {
    const first = await uploadLookIntoVault(cubeFile('Teal.cube'));
    const writes = saved.length;
    // A renamed copy of the same file: the HASH is what is matched, so it is
    // the same look and the index does not grow.
    const again = await uploadLookIntoVault(cubeFile('Teal copy.cube'));

    expect(again.ref).toEqual(first.ref);
    expect(stored.size).toBe(1);
    expect(saved.length).toBe(writes);
  });

  it('gives two different looks two different ids', async () => {
    const a = await uploadLookIntoVault(cubeFile('Look.cube'));
    const b = await uploadLookIntoVault(
      cubeFile('Look.cube', IDENTITY_CUBE.replace('1 1 1', '0.9 0.9 0.9')),
    );
    expect(a.ref.look).toBe('look');
    expect(b.ref.look).toBe('look-2');
    expect(stored.size).toBe(2);
  });

  it('refuses a file that is not a 3D .cube, rather than storing junk', async () => {
    await expect(uploadLookIntoVault(cubeFile('notes.cube', 'hello'))).rejects.toThrow(/3D \.cube/);
    expect(stored.size).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('uploadedLabel keeps the author’s own name, minus the extension', () => {
    expect(uploadedLabel('My Teal Grade.cube')).toBe('My Teal Grade');
    expect(uploadedLabel('AUTHENTIC_LUT_D-LOG.CUBE')).toBe('AUTHENTIC_LUT_D-LOG');
    expect(uploadedLabel('.cube')).toBe('.cube');
  });
});
