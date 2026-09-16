import { describe, expect, it } from 'vitest';
import {
  availabilityText,
  fetchOrder,
  keepWindow,
  photoFiles,
  pictureDay,
  splitByRoll,
  summarizeAvailability,
  type PictureAvailability,
} from './roll-media';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

describe('fetchOrder', () => {
  it('asks for the open picture first, then its neighbours, the next before the previous', () => {
    expect(fetchOrder(ids, 'd', 2)).toEqual(['d', 'e', 'c', 'f', 'b']);
  });

  it('stays inside the strip at its ends', () => {
    expect(fetchOrder(ids, 'a', 2)).toEqual(['a', 'b', 'c']);
    expect(fetchOrder(ids, 'g', 2)).toEqual(['g', 'f', 'e']);
  });

  it('starts from the first picture when none is named, and asks nothing of an empty roll', () => {
    expect(fetchOrder(ids, null, 1)).toEqual(['a', 'b']);
    expect(fetchOrder(ids, 'unknown', 1)).toEqual(['a', 'b']);
    expect(fetchOrder([], 'a')).toEqual([]);
  });
});

describe('keepWindow', () => {
  it('keeps what is within reach of the open picture', () => {
    expect([...keepWindow(ids, 'd', 1)]).toEqual(['c', 'd', 'e']);
    expect([...keepWindow(ids, 'a', 2)]).toEqual(['a', 'b', 'c']);
    expect(keepWindow([], 'a').size).toBe(0);
  });
});

describe('summarizeAvailability', () => {
  it('counts each state and keeps the first problem worth saying', () => {
    const map = new Map<string, PictureAvailability>([
      ['a', { kind: 'ready' }],
      ['b', { kind: 'fetching', sourceId: 'w.example' }],
      ['c', { kind: 'failed', sourceId: 'w.example', problem: 'Not signed in to w.example.', loginUrl: 'https://w.example/login' }],
      ['d', { kind: 'failed', sourceId: 'w.example', problem: 'later problem' }],
      ['e', { kind: 'gone', sourceId: 'w.example' }],
      ['f', { kind: 'unconnected', sourceId: 'other.example' }],
      ['g', { kind: 'local' }],
    ]);
    expect(summarizeAvailability(ids, map)).toEqual({
      fetching: 1,
      previewed: 0,
      failed: 2,
      gone: 1,
      unconnected: 1,
      local: 1,
      sourceId: 'w.example',
      unconnectedSourceId: 'other.example',
      problem: 'Not signed in to w.example.',
      loginUrl: 'https://w.example/login',
    });
  });

  it('says nothing about a roll whose pictures are all in hand', () => {
    const s = summarizeAvailability(['a'], new Map([['a', { kind: 'ready' } as PictureAvailability]]));
    expect(s.fetching + s.previewed + s.failed + s.gone + s.unconnected + s.local).toBe(0);
    expect(summarizeAvailability(['a'], new Map([['a', { kind: 'preview' } as PictureAvailability]])).previewed).toBe(1);
    expect(s.sourceId).toBeNull();
  });
});

describe('availabilityText', () => {
  it('names the picture and the instance in every state', () => {
    expect(availabilityText('A.webp', { kind: 'fetching', sourceId: 'w.example' })).toBe('Fetching A.webp from w.example…');
    expect(availabilityText('A.webp', { kind: 'gone', sourceId: 'w.example' })).toContain('no longer has A.webp');
    expect(availabilityText('A.webp', { kind: 'unconnected', sourceId: 'w.example' })).toContain('connect it in Sources');
    expect(availabilityText('A.jpg', { kind: 'local' })).toContain('from this computer');
    expect(availabilityText('A.jpg', undefined)).toContain('from this computer');
  });
});

describe('pictureDay', () => {
  it('reads the local calendar day of the capture, else of now', () => {
    const noon = new Date(2026, 5, 10, 12).getTime();
    expect(pictureDay(noon)).toBe('2026-06-10');
    expect(pictureDay(0, new Date(2026, 0, 2, 9).getTime())).toBe('2026-01-02');
  });
});

describe('photoFiles', () => {
  it('keeps the photographs, a RAW yielding to its JPEG, and drops clips and logs', () => {
    const f = (name: string) => new File(['x'], name);
    const names = photoFiles([f('A.ARW'), f('A.JPG'), f('B.jpg'), f('C.MP4'), f('C.SRT'), f('.hidden.jpg')]).map((x) => x.name);
    expect(names).toEqual(['A.JPG', 'B.jpg']);
  });
});

describe('splitByRoll', () => {
  const ref = (name: string, hash?: string) => ({ name, size: 10, lastModified: 1, ...(hash ? { hash } : {}) });
  it('counts what the roll holds and keeps each new picture once', () => {
    const held = [ref('A.jpg', 'ha'), ref('B.jpg', 'hb')];
    const out = splitByRoll(held, [ref('renamed.jpg', 'ha'), ref('C.jpg', 'hc'), ref('C-copy.jpg', 'hc'), ref('D.jpg', 'hd')]);
    expect(out.found).toBe(1);
    expect(out.fresh.map((r) => r.name)).toEqual(['C.jpg', 'D.jpg']);
  });
});

