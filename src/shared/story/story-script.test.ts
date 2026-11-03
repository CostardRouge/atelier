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

  it('reads the series’ look and hands it to every post', () => {
    const parsed = parseScript({ ...script, look: { wall: { cols: 6, gap: 99 }, vignette: 2, grain: 'x' } });
    expect(parsed.ok && parsed.script.look).toEqual({ wall: { cols: 6, gap: 40 }, vignette: 0.8 });
    if (parsed.ok) expect(assemble(registry[0], parsed.script, registry).look).toEqual(parsed.script.look);
    expect(assemble(registry[0], script, registry).look).toBeUndefined();
  });

  it('reads the series’ language, English or French, and nothing else', () => {
    const en = parseScript({ ...script, lang: 'en' });
    expect(en.ok && en.script.lang).toBe('en');
    const de = parseScript({ ...script, lang: 'de' });
    expect(de.ok && de.script.lang).toBeUndefined();
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

describe('the map in a script', () => {
  it('reads channels and topics, keeping only well-formed states', () => {
    const parsed = parseScript({
      ...script,
      channels: [{ id: 'ig', name: 'Instagram', format: 'Reels' }, { name: 'no id' }],
      topics: [
        { id: 'p', title: 'Pilier', order: 1 },
        { id: 'v0', title: 'EP.00', parent: 'p', post: 'a', proposed: true, cells: { ig: { s: 'publie', date: '2026-11-01' }, li: { s: 'nope' } } },
        { title: 'no id' },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.script.channels).toEqual([{ id: 'ig', name: 'Instagram', format: 'Reels', voice: undefined }]);
    expect(parsed.script.topics).toHaveLength(2);
    expect(parsed.script.topics![1]).toMatchObject({ parent: 'p', post: 'a', proposed: true, cells: { ig: { s: 'publie', date: '2026-11-01' } } });
    expect(parsed.script.topics![1].cells!.li).toBeUndefined();
  });
});

describe('the Studio’s settings in a script', () => {
  it('reads the charte and the objects of the series and of a post', () => {
    const parsed = parseScript({
      ...script,
      look: { charte: { palette: { acc: '#ff0000' } }, objects: { caption: { size: 120 } } },
      posts: { a: { title: 'Premier', objects: { 'counter.number': { dx: 4 } } } },
    });
    expect(parsed.ok && parsed.script.look).toEqual({ charte: { palette: { acc: '#ff0000' } }, objects: { caption: { size: 120 } } });
    expect(parsed.ok && parsed.script.posts.a.objects).toEqual({ 'counter.number': { dx: 4 } });
    if (parsed.ok) expect(assemble(registry[0], parsed.script, registry).objects).toEqual({ 'counter.number': { dx: 4 } });
  });

  it('lets a post set a scene’s length and its caption’s window, kept inside the scene', () => {
    const own: StoryScript = { ...script, posts: { a: { blocks: [{ len: 6, cap: { a: 1, b: 9 } }] } } };
    const ep = assemble(registry[0], own, registry);
    expect(ep.blocks[0].len).toBe(6);
    expect(ep.blocks[0].cap).toMatchObject({ a: 1, b: 6 });
    expect(ep.blocks[1].len).toBe(5);
    const parsed = parseScript({ ...script, posts: { a: { blocks: [{ len: 0.1, cap: { a: 3, b: 2 } }] } } });
    expect(parsed.ok && parsed.script.posts.a.blocks?.[0]).toEqual({ caption: undefined, params: undefined, len: 0.5 });
  });
});

describe('the wall says what was counted', () => {
  it('its number is media.total when the script names none, and the script wins when it does', async () => {
    const { assemble, newScript } = await import('./story-script');
    const skel = { id: 'ep00', number: 'EP.00', season: 1, blocks: [{ block: 'wall', len: 4 }] };
    const counted = { ...newScript('S'), facts: { at: '2025-01-01T00:00:00Z', values: { 'media.total': 60 } } };
    expect(assemble(skel, counted, [skel]).blocks[0].params?.count).toBe(60);
    const own = { ...counted, posts: { ep00: { blocks: [{ params: { count: 98412 } }] } } };
    expect(assemble(skel, own, [skel]).blocks[0].params?.count).toBe(98412);
  });
});
