import { describe, expect, it } from 'vitest';
import { BLOCK_WORDS, partOf, withBlockParam, wordsOf, wordText, wordValue } from './block-words';
import { newScript } from './story-script';

describe('block words', () => {
  it('a part shows its own fields, the scene all of them', () => {
    expect(partOf('counter.label')).toEqual({ block: 'counter', part: 'label' });
    expect(wordsOf('counter.label').map((f) => f.param)).toEqual(['label']);
    expect(wordsOf('counter.number').map((f) => f.param)).toEqual(['to', 'from', 'unit']);
    expect(wordsOf('counter')).toHaveLength(BLOCK_WORDS.counter.length);
    expect(wordsOf('map-camera.route')).toEqual([]);
  });
  it('numbers keep a {fact}, lines split, rows read their fields', () => {
    const [to] = wordsOf('counter.number');
    expect(wordValue(to, '98 412')).toBe(98412);
    expect(wordValue(to, '{media.total}')).toBe('{media.total}');
    expect(wordValue(to, '  ')).toBeUndefined();
    const [before] = wordsOf('before-after.before');
    expect(wordValue(before, 'one\n\n two ')).toEqual(['one', 'two']);
    const [devices] = wordsOf('gear.names');
    const rows = wordValue(devices, 'Sony A7C II · main · camera\nDJI Mini 4 Pro');
    expect(rows).toEqual([{ name: 'Sony A7C II', note: 'main', kind: 'camera' }, { name: 'DJI Mini 4 Pro' }]);
    expect(wordText(devices, rows)).toBe('Sony A7C II · main · camera\nDJI Mini 4 Pro');
  });
  it('folder columns mark the open item', () => {
    const [cols] = wordsOf('folders.columns');
    const v = wordValue(cols, '2024, *2025, 2026\nJan, Feb');
    expect(v).toEqual([{ items: ['2024', '2025', '2026'], sel: 1 }, { items: ['Jan', 'Feb'] }]);
    expect(wordText(cols, v)).toBe('2024, *2025, 2026\nJan, Feb');
  });
  it('writes a post’s param, and takes it away', () => {
    let s = withBlockParam(newScript('S'), 'ep01', 2, 'label', 'photos');
    expect(s.posts.ep01.blocks?.[2].params).toEqual({ label: 'photos' });
    s = withBlockParam(s, 'ep01', 2, 'label', undefined);
    expect(s.posts.ep01.blocks?.[2].params).toBeUndefined();
  });
});
