import { describe, expect, it } from 'vitest';
import { reconcileMedia } from './reconcile';
import type { SavedMediaRef } from './project-types';

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
