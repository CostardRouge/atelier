import { describe, expect, it } from 'vitest';
import { assemble, parseScript, placeholderCaption, SCRIPT_KIND, type PostSkeleton, type StoryScript } from './story-script';

const registry: PostSkeleton[] = [
  { id: 'a', number: 'EP.00', season: 1, blocks: [{ block: 'wall', len: 4, cap: { a: 0.5, b: 3.5 } }, { block: 'folders', len: 5, cap: null }] },
  { id: 'b', number: 'EP.01', season: 1, blocks: [{ block: 'counter', len: 4, cap: { a: 0.5, b: 3.5 } }] },
  { id: 'c', number: 'EP.00', season: 2, blocks: [] },
];

const script: StoryScript = {
  kind: SCRIPT_KIND,
  version: 1,
  series: 'Série',
  handle: '@moi',
  ask: 'Enregistre',
  posts: {
    a: { title: 'Premier', cover: '1 → 2', blocks: [{ params: { count: '10' }, caption: 'Dix photos.' }] },
    b: { title: 'Second' },
  },
};

describe('parseScript', () => {
  it('reads a script and keeps only well-formed parts', () => {
    const parsed = parseScript({
      ...script,
      stops: [['Perth', 115.86, -31.95, '02 jan.'], ['bad', 'x', 0, '']],
      posts: { a: { title: 'Premier', blocks: [{ caption: 'Oui' }, 'nope'] }, z: 'nope' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.script.stops).toEqual([['Perth', 115.86, -31.95, '02 jan.']]);
    expect(parsed.script.posts.a.blocks).toEqual([{ caption: 'Oui', params: undefined }, { caption: undefined, params: undefined }]);
    expect(parsed.script.posts.z).toBeUndefined();
  });

  it('refuses what is not a version-1 story script, saying why', () => {
    expect(parseScript(null)).toMatchObject({ ok: false });
    expect(parseScript({ kind: 'other', version: 1, posts: {} })).toMatchObject({ ok: false });
    const v2 = parseScript({ kind: SCRIPT_KIND, version: 2, posts: {} });
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.reason).toContain('version 2');
  });
});

describe('assemble', () => {
  it('joins the skeleton and the script: words on the caption windows, params merged', () => {
    const ep = assemble(registry[0], script, registry);
    expect(ep.title).toBe('Premier');
    expect(ep.cover).toEqual({ line: '1 → 2' });
    expect(ep.blocks[0]).toEqual({ block: 'wall', len: 4, params: { count: '10' }, cap: { a: 0.5, b: 3.5, text: 'Dix photos.' } });
    expect(ep.blocks[1].cap).toBeNull();
  });

  it('names the next post of the same season, and closes the season otherwise', () => {
    expect(assemble(registry[0], script, registry).next).toEqual({ number: 'EP.01', title: 'Second' });
    const last = assemble(registry[1], script, registry);
    expect(last.next).toBeNull();
    expect(last.closing).toEqual({ series: 'Série', handle: '@moi', ask: 'Enregistre' });
  });

  it('plays without a script: the number for a title, placeholders for the words', () => {
    const ep = assemble(registry[0], null, registry);
    expect(ep.title).toBe('EP.00');
    expect(ep.blocks[0].cap?.text).toBe(placeholderCaption(0));
    expect(ep.next).toEqual({ number: 'EP.01', title: 'EP.01' });
  });
});
