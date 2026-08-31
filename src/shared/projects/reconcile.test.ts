import { describe, expect, it } from 'vitest';
import { adoptRenames, reconcileMedia } from './reconcile';
import type { ProjectMedia, SavedMediaRef } from './project-types';

const ref = (name: string, size = 100, lastModified = 1000): SavedMediaRef => ({
  name,
  size,
  lastModified,
});

describe('reconcileMedia', () => {
  it('classifies untouched media as found', () => {
    const saved = [ref('DJI_0001.MP4'), ref('DJI_0001.SRT', 5)];
    const r = reconcileMedia(saved, [ref('DJI_0001.MP4'), ref('DJI_0001.SRT', 5)]);
    expect(r.found).toBe(2);
    expect(r.changed).toBe(0);
    expect(r.missing).toBe(0);
  });

  it('matches names case-insensitively (DJI cards mix casing)', () => {
    const r = reconcileMedia([ref('DJI_0001.MP4')], [ref('dji_0001.mp4')]);
    expect(r.items[0].status).toBe('found');
  });

  it('flags a size or mtime difference as changed', () => {
    const r = reconcileMedia(
      [ref('a.mp4', 100, 1000), ref('b.mp4', 100, 1000)],
      [ref('a.mp4', 999, 1000), ref('b.mp4', 100, 2000)],
    );
    expect(r.items.map((i) => i.status)).toEqual(['changed', 'changed']);
  });

  it('flags absent files as missing without dropping the rest', () => {
    const r = reconcileMedia(
      [ref('kept.mp4'), ref('gone.mp4')],
      [ref('kept.mp4')],
    );
    expect(r.found).toBe(1);
    expect(r.missing).toBe(1);
    expect(r.items[1].ref.name).toBe('gone.mp4');
  });

  it('ignores extra files in the folder (new sources are welcome, not errors)', () => {
    const r = reconcileMedia([ref('a.mp4')], [ref('a.mp4'), ref('new.mp4')]);
    expect(r.items).toHaveLength(1);
    expect(r.found).toBe(1);
  });

  it('handles an empty folder listing (no permission / handle gone)', () => {
    const r = reconcileMedia([ref('a.mp4')], []);
    expect(r.missing).toBe(1);
  });

  it('keeps the first claim when the folder holds duplicate names', () => {
    const r = reconcileMedia(
      [ref('a.mp4', 100, 1000)],
      [ref('A.MP4', 100, 1000), ref('a.mp4', 5, 5)],
    );
    expect(r.items[0].status).toBe('found');
  });
});

describe('reconcileMedia — id and hash resolution', () => {
  it('matches by assetId before anything else', () => {
    const r = reconcileMedia(
      [{ ...ref('old.mp4'), assetId: '1234' }],
      [{ ...ref('renamed.mp4', 999, 42), assetId: '1234' }],
    );
    expect(r.items[0].matchedBy).toBe('id');
    expect(r.items[0].status).toBe('found');
    expect(r.items[0].actual?.name).toBe('renamed.mp4');
  });

  it('matches by hash across a rename, and calls it found rather than changed', () => {
    // The mtime differs because it is a copy; the content is provably the same.
    const r = reconcileMedia(
      [{ ...ref('DJI_0001.MP4'), hash: 'abc' }],
      [{ ...ref('sunset-graded.mp4', 100, 9999), hash: 'abc' }],
    );
    expect(r.items[0].matchedBy).toBe('hash');
    expect(r.items[0].status).toBe('found');
    expect(r.renamed).toBe(1);
  });

  it('falls back to the name when the hash finds nothing', () => {
    const r = reconcileMedia(
      [{ ...ref('a.mp4'), hash: 'gone' }],
      [{ ...ref('a.mp4'), hash: 'other' }],
    );
    expect(r.items[0].matchedBy).toBe('name');
    expect(r.items[0].status).toBe('found');
  });

  it('keeps the old name-only behaviour for documents written before hashes', () => {
    const r = reconcileMedia([ref('a.mp4', 100, 1000)], [ref('a.mp4', 999, 1000)]);
    expect(r.items[0].matchedBy).toBe('name');
    expect(r.items[0].status).toBe('changed');
    expect(r.renamed).toBe(0);
  });

  it('does not count a case-only difference as a rename', () => {
    const r = reconcileMedia(
      [{ ...ref('DJI_0001.MP4'), hash: 'abc' }],
      [{ ...ref('dji_0001.mp4'), hash: 'abc' }],
    );
    expect(r.renamed).toBe(0);
  });
});

const media = (over: Partial<ProjectMedia> = {}): ProjectMedia => ({
  dirHandle: null,
  files: [],
  activeId: null,
  trims: {},
  ...over,
});

describe('adoptRenames', () => {
  it('returns null when nothing was renamed, so the caller skips the write', () => {
    const r = reconcileMedia([ref('a.mp4')], [ref('a.mp4')]);
    expect(adoptRenames(media({ files: [ref('a.mp4')] }), r)).toBeNull();
  });

  it('rewrites the file list, the active clip and the trim keys together', () => {
    const saved = { ...ref('DJI_0001.MP4'), hash: 'abc' };
    const now = { ...ref('sunset.mp4', 100, 5000), hash: 'abc' };
    const r = reconcileMedia([saved], [now]);

    const adopted = adoptRenames(
      media({
        files: [saved],
        activeId: 'DJI_0001',
        trims: { DJI_0001: { start: 1, end: 2, duration: 10 } },
      }),
      r,
    );

    expect(adopted?.files[0].name).toBe('sunset.mp4');
    expect(adopted?.files[0].lastModified).toBe(5000);
    // The hash that found it survives.
    expect(adopted?.files[0].hash).toBe('abc');
    expect(adopted?.activeId).toBe('sunset');
    expect(Object.keys(adopted?.trims ?? {})).toEqual(['sunset']);
  });

  it('leaves an untouched clip alone while renaming its neighbour', () => {
    const kept = ref('keep.mp4');
    const moved = { ...ref('old.mp4'), hash: 'h' };
    const r = reconcileMedia([kept, moved], [kept, { ...ref('new.mp4'), hash: 'h' }]);
    const adopted = adoptRenames(media({ files: [kept, moved], activeId: 'keep' }), r);
    expect(adopted?.files.map((f) => f.name)).toEqual(['keep.mp4', 'new.mp4']);
    expect(adopted?.activeId).toBe('keep');
  });

  it('renames the SRT with its clip, so the pair stays one asset', () => {
    const video = { ...ref('DJI_0001.MP4'), hash: 'v' };
    const srt = { ...ref('DJI_0001.SRT', 5), hash: 's' };
    const r = reconcileMedia(
      [video, srt],
      [
        { ...ref('flight.MP4'), hash: 'v' },
        { ...ref('flight.SRT', 5), hash: 's' },
      ],
    );
    const adopted = adoptRenames(media({ files: [video, srt], activeId: 'DJI_0001' }), r);
    expect(adopted?.files.map((f) => f.name)).toEqual(['flight.MP4', 'flight.SRT']);
    expect(adopted?.activeId).toBe('flight');
  });
});
