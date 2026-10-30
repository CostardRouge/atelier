import { describe, expect, it } from 'vitest';
import { channelsOf, coverage, DEFAULT_CHANNELS, flatten, hasWork, leavesOf, mapRows, nextState, withCell } from './story-map';
import { SCRIPT_KIND, type PostSkeleton, type StoryScript } from './story-script';

const last = <T,>(list: readonly T[]): T => list[list.length - 1];

const posts: PostSkeleton[] = [
  { id: 'ep00', number: 'EP.00', season: 1, blocks: [] },
  { id: 'ep01', number: 'EP.01', season: 1, blocks: [] },
  { id: 'ep02', number: 'EP.02', season: 1, blocks: [] },
];

const script: StoryScript = {
  kind: SCRIPT_KIND,
  version: 1,
  posts: { ep02: { title: 'Le tri' } },
  channels: [{ id: 'ig', name: 'Instagram' }, { id: 'li', name: 'LinkedIn' }],
  topics: [
    { id: 'p-apps', title: 'Les apps', order: 2 },
    { id: 'p-terrain', title: 'Le terrain', order: 1 },
    { id: 's1', title: 'Saison 1', parent: 'p-apps', order: 1 },
    { id: 'v0', title: 'EP.00', parent: 's1', order: 1, post: 'ep00', cells: { ig: { s: 'encours' } } },
    { id: 'v1', title: 'EP.01', parent: 's1', order: 2, post: 'ep01', cells: { ig: { s: 'publie', date: '2026-11-01' } } },
    { id: 'drone', title: 'Le drone', parent: 'p-terrain', cells: { li: { s: 'non' } } },
    { id: 'orphan', title: 'Sans parent', parent: 'gone' },
  ],
};

describe('mapRows', () => {
  it('files pillars, subjects and versions in order, and links a line to its post', () => {
    const rows = mapRows(script, posts);
    expect(rows.map((r) => r.topic.id)).toEqual(['p-terrain', 'p-apps', 'orphan', 'unfiled-posts']);
    const s1 = rows[1].children[0];
    expect(s1.children.map((r) => r.post?.id)).toEqual(['ep00', 'ep01']);
    expect(s1.children[0].depth).toBe(2);
  });

  it('never hides a post no line names', () => {
    const unfiled = last(mapRows(script, posts));
    expect(unfiled.children.map((r) => [r.post?.id, r.topic.title])).toEqual([['ep02', 'Le tri']]);
    expect(last(mapRows(null, posts)).children).toHaveLength(3);
  });

  it('counts the lines that carry states', () => {
    const rows = mapRows(script, posts);
    const leaves = rows.flatMap(leavesOf);
    expect(flatten(rows).length).toBeGreaterThan(leaves.length);
    expect(coverage(leaves, 'ig')).toMatchObject({ encours: 1, publie: 1 });
  });
});

describe('the states', () => {
  it('cycles nothing → idea → in progress → ready → published → not here → nothing', () => {
    const seen = [null, 'idee', 'encours', 'pret', 'publie', 'non', null];
    for (let i = 0; i < seen.length - 1; i++) expect(nextState(seen[i] as never)).toBe(seen[i + 1]);
  });

  it('writes one crossing, dating a publication, and adds a post no line named', () => {
    const rows = mapRows(script, posts);
    const v0 = rows[1].children[0].children[0];
    const next = withCell(script, v0, 'ig', 'publie', '2026-11-02');
    expect(next.topics!.find((t) => t.id === 'v0')!.cells!.ig).toEqual({ s: 'publie', date: '2026-11-02' });
    expect(withCell(next, v0, 'ig', null, 'x').topics!.find((t) => t.id === 'v0')!.cells!.ig).toBeUndefined();
    const loose = last(rows).children[0];
    const added = withCell(script, loose, 'li', 'idee', 'x');
    expect(last(added.topics!)).toMatchObject({ post: 'ep02', cells: { li: { s: 'idee' } } });
  });

  it('knows what still has work', () => {
    expect(hasWork(script.topics![3])).toBe(true);
    expect(hasWork(script.topics![4])).toBe(false);
  });

  it('maps against default channels when the script names none', () => {
    expect(channelsOf(null)).toBe(DEFAULT_CHANNELS);
    expect(channelsOf(script).map((c) => c.id)).toEqual(['ig', 'li']);
  });
});
