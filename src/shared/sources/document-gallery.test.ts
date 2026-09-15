import { describe, expect, it } from 'vitest';
import { groupDocuments, sourceLabel, type RemoteList } from './document-gallery';

type Doc = { id: string; sourceId: string };
const doc = (id: string, sourceId = 'local'): Doc => ({ id, sourceId });
const row = (id: string, sourceId: string) => ({ doc: doc(id, sourceId), etag: `"${id}"`, updatedAt: '2026-09-15T10:00:00Z' });

describe('groupDocuments', () => {
  it('draws this browser first, even empty, and every instance with a bucket even with nothing mirrored', () => {
    const groups = groupDocuments<Doc, ReturnType<typeof row>>([], ['winnow.example'], {});
    expect(groups.map((g) => [g.id, g.items.length, g.list, g.remoteOnly.length])).toEqual([
      ['local', 0, undefined, 0],
      ['winnow.example', 0, undefined, 0],
    ]);
  });

  it('shows a document mirrored here once, and one only there as remote-only', () => {
    const lists: Record<string, RemoteList<ReturnType<typeof row>>> = {
      'winnow.example': { status: 'ok', rows: [row('a', 'winnow.example'), row('b', 'winnow.example')] },
    };
    const groups = groupDocuments([doc('l1'), doc('a', 'winnow.example')], ['winnow.example'], lists);
    const remote = groups.find((g) => g.id === 'winnow.example')!;
    expect(remote.items.map((d) => d.id)).toEqual(['a']);
    expect(remote.remoteOnly.map((r) => r.doc.id)).toEqual(['b']);
    expect(groups.find((g) => g.id === 'local')!.items.map((d) => d.id)).toEqual(['l1']);
  });

  it('offers nothing remote-only while an instance is loading or has failed', () => {
    const groups = groupDocuments([doc('a', 'x.host')], ['x.host', 'y.host'], {
      'x.host': { status: 'loading' },
      'y.host': { status: 'failed', text: 'x.host is unreachable' },
    });
    expect(groups.map((g) => [g.id, g.remoteOnly.length, g.list?.status])).toEqual([
      ['local', 0, undefined],
      ['x.host', 0, 'loading'],
      ['y.host', 0, 'failed'],
    ]);
  });

  it('names this browser in words', () => {
    expect(sourceLabel('local')).toBe('this browser');
    expect(sourceLabel('unknown.host')).toBe('unknown.host');
  });
});
