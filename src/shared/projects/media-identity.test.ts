import { describe, expect, it, vi } from 'vitest';
import { findMedia, hashedMediaRef, hashedMediaRefs, mediaHash } from './media-identity';
import { partialHash } from '../lib/partial-hash';
import type { SavedMediaRef } from './project-types';

/** A `File` with deterministic, distinguishable bytes. */
const file = (name: string, seed: number, size = 32, lastModified = 1000) =>
  new File([Uint8Array.from({ length: size }, (_, i) => (i + seed) % 251)], name, {
    lastModified,
  });

describe('mediaHash', () => {
  it('agrees with the pure hash', async () => {
    const f = file('a.mp4', 1);
    expect(await mediaHash(f)).toBe(await partialHash(f));
  });

  it('memoises by name+size+mtime, so a folder is read once per session', async () => {
    const f = file('memo.mp4', 2);
    const spy = vi.spyOn(f, 'slice');
    await mediaHash(f);
    const reads = spy.mock.calls.length;
    expect(reads).toBeGreaterThan(0);

    // A different File OBJECT for the same underlying file must not re-read.
    const again = file('memo.mp4', 2);
    const spyAgain = vi.spyOn(again, 'slice');
    await mediaHash(again);
    expect(spyAgain).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing when the bytes cannot be read', async () => {
    const broken = file('broken.mp4', 3);
    vi.spyOn(broken, 'slice').mockImplementation(() => {
      throw new Error('permission revoked mid-listing');
    });
    expect(await mediaHash(broken)).toBeNull();
  });
});

describe('hashedMediaRef', () => {
  it('carries the hash beside the existing keys', async () => {
    const f = file('clip.mp4', 4, 32, 4242);
    const ref = await hashedMediaRef(f);
    expect(ref).toMatchObject({ name: 'clip.mp4', size: 32, lastModified: 4242 });
    expect(ref.hash).toBe(await partialHash(f));
  });

  it('omits the hash rather than storing a null when reading failed', async () => {
    const broken = file('unreadable.mp4', 5);
    vi.spyOn(broken, 'slice').mockImplementation(() => {
      throw new Error('gone');
    });
    expect(await hashedMediaRef(broken)).not.toHaveProperty('hash');
  });

  it('preserves order across a listing', async () => {
    const files = [file('c.mp4', 6), file('a.mp4', 7), file('b.mp4', 8)];
    const refs = await hashedMediaRefs(files);
    expect(refs.map((r) => r.name)).toEqual(['c.mp4', 'a.mp4', 'b.mp4']);
  });
});

describe('findMedia', () => {
  const asRef = async (f: File): Promise<SavedMediaRef> => hashedMediaRef(f);

  it('finds by name without reading a byte', async () => {
    const f = file('same.mp4', 9);
    const ref = await asRef(f);
    const candidate = file('same.mp4', 9);
    const spy = vi.spyOn(candidate, 'slice');
    expect(await findMedia(ref, [candidate])).toBe(candidate);
    expect(spy).not.toHaveBeenCalled();
  });

  it('finds a renamed file by its hash', async () => {
    const original = file('DJI_0001.MP4', 10);
    const ref = await asRef(original);
    const renamed = new File([await original.arrayBuffer()], 'sunset-graded.mp4');
    expect(await findMedia(ref, [renamed])).toBe(renamed);
  });

  it('only hashes the same-size candidates', async () => {
    const original = file('gone.mp4', 11, 32);
    const ref = await asRef(original);
    const wrongSize = file('other.mp4', 12, 64);
    const spy = vi.spyOn(wrongSize, 'slice');
    await findMedia(ref, [wrongSize]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null when the ref carries no hash and the name is gone', async () => {
    const ref: SavedMediaRef = { name: 'vanished.mp4', size: 32, lastModified: 1 };
    expect(await findMedia(ref, [file('other.mp4', 13)])).toBeNull();
  });

  it('returns null rather than guessing when nothing matches', async () => {
    const ref = await asRef(file('a.mp4', 14));
    expect(await findMedia(ref, [file('b.mp4', 15)])).toBeNull();
  });
});
