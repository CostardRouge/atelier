import { describe, expect, it } from 'vitest';
import { absentSources, groupDocuments, sourceLabel, type RemoteList } from './document-gallery';

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

describe('absentSources — a connected instance that draws no group', () => {
  const connections = [{ id: 'winnow.example' }, { id: 'other.example' }];

  it('says nothing while the stale sheet is still being re-asked', () => {
    // The group may be about to appear: a sentence here would flash and lie.
    expect(absentSources(connections, ['winnow.example'], 'roll', {})).toEqual([
      { sourceId: 'other.example', text: null },
    ]);
  });

  it('names the instance once the sheet has been re-read and still lacks the kind', () => {
    const [absent] = absentSources(connections, ['winnow.example'], 'roll', {
      'other.example': { state: 'read' },
    });
    expect(absent.sourceId).toBe('other.example');
    expect(absent.text).toContain('does not keep rolls');
    // The point of the sentence: it rules out this device's own staleness.
    expect(absent.text).toContain('asked again just now');
  });

  it('says it could not be asked rather than what it keeps, when the probe was refused', () => {
    const [absent] = absentSources(connections, [], 'trip', {
      'winnow.example': { state: 'refused', problem: 'Not signed in.' },
      'other.example': { state: 'read' },
    });
    expect(absent.text).toBe('winnow.example could not be asked what it keeps: Not signed in.');
  });

  it('is empty when every connected instance keeps the kind', () => {
    expect(absentSources(connections, ['winnow.example', 'other.example'], 'project', {})).toEqual([]);
  });
});
