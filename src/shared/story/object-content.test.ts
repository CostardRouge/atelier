import { describe, expect, it } from 'vitest';
import { objectContent, withBlockCaption, withPostNumber, type ContentContext } from './object-content';
import type { StoryScript } from './story-script';

const script = {
  kind: 'atelier.story-script',
  version: 1,
  series: 'Le tri d’Australie',
  posts: { ep00: { hooks: [{ lines: ['100 000 photos.', 'Aucune triée.'] }, { lines: ['Variant B'] }], hookActive: 0, blocks: [{ caption: 'Tout est sur mon NAS: {media.total} photos.' }] } },
} as unknown as StoryScript;
const series = { series: 'Le tri d’Australie', number: 'EP.00', from: 'Perth', to: 'Cairns', since: '2025-01-02', today: '2026-01-02', lang: 'fr' as const };
const ctx = (over: Partial<ContentContext> = {}): ContentContext => ({ script, postId: 'ep00', hook: script.posts.ep00.hooks![0], hookIndex: 0, series, sceneIndex: 0, number: 'EP.00', ...over });

describe('what an object says', () => {
  it('types the big text and the second line into the variant that plays', () => {
    const big = objectContent('hook.big', ctx())!;
    expect(big.field?.value).toBe('100 000 photos.');
    expect(big.from).toMatch(/variant A/);
    const next = big.field!.write(script, '120 000 photos.');
    expect(next.posts.ep00.hooks![0].lines).toEqual(['120 000 photos.', 'Aucune triée.']);
    expect(next.posts.ep00.hooks![1].lines).toEqual(['Variant B']);
    const second = objectContent('hook.second', ctx())!;
    expect(second.field!.write(script, '').posts.ep00.hooks![0].lines).toEqual(['100 000 photos.']);
  });

  it('shows what a piece computes, and this post’s own words over it', () => {
    const header = objectContent('hook.header', ctx())!;
    expect(header.kind).toBe('computed');
    expect(header.says).toBe('Le tri d’Australie · EP.00');
    expect(header.link?.to).toBe('script');
    const own = header.field!.write(script, 'Saison 1 · Épisode zéro');
    expect(own.posts.ep00.hooks![0].pieces).toEqual({ header: 'Saison 1 · Épisode zéro' });
    expect(objectContent('hook.place', ctx())!.says).toBe('◆ Perth → Cairns');
  });

  it('types a caption into its scene, and says when it cites a counted fact', () => {
    const cap = objectContent('caption', ctx())!;
    expect(cap.field?.multiline).toBe(true);
    expect(cap.from).toMatch(/\{media\.total\}/);
    expect(cap.link?.to).toBe('sources');
    expect(withBlockCaption(script, 'ep00', 2, 'Troisième').posts.ep00.blocks![2].caption).toBe('Troisième');
    expect(withBlockCaption(script, 'ep00', 0, '').posts.ep00.blocks![0].caption).toBeUndefined();
  });

  it('gives the HUD this post’s number, its own when set', () => {
    expect(objectContent('hud.number', ctx())!.says).toBe('EP.00');
    const own = withPostNumber(script, 'ep00', 'EP.00 bis');
    expect(objectContent('hud.number', ctx({ script: own }))!).toMatchObject({ says: 'EP.00 bis', kind: 'this post' });
    expect(withPostNumber(own, 'ep00', ' ').posts.ep00.number).toBeUndefined();
  });

  it('says the credit is the licence’s, and nothing for an object it does not know', () => {
    expect(objectContent('map.credit', ctx())!.kind).toBe('licence');
    expect(objectContent('wall.pictures', ctx())).toBeNull();
  });
});
