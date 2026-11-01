import { describe, expect, it } from 'vitest';
import { SCRIPT_KIND, type StoryScript } from './story-script';
import { styleIn, withCharte, withSceneTiming, withStyle, withoutStyle } from './studio-edit';

const base: StoryScript = { kind: SCRIPT_KIND, version: 1, posts: { a: { title: 'A' } } };

describe('an object’s settings', () => {
  it('are kept for the series or the post alone, and a field set to undefined goes', () => {
    const one = withStyle(base, 'a', 'caption', { size: 120, color: '@acc' }, 'series');
    expect(one.look?.objects).toEqual({ caption: { size: 120, color: '@acc' } });
    const two = withStyle(one, 'a', 'caption', { size: 90 }, 'post');
    expect(two.posts.a).toEqual({ title: 'A', objects: { caption: { size: 90 } } });
    expect(styleIn(two, 'a', 'caption', 'series')).toEqual({ size: 120, color: '@acc' });
    const three = withStyle(two, 'a', 'caption', { color: undefined }, 'series');
    expect(three.look?.objects).toEqual({ caption: { size: 120 } });
  });

  it('leave no trace once forgotten', () => {
    const set = withStyle(base, 'a', 'hud', { hidden: true }, 'series');
    expect(withoutStyle(set, 'a', 'hud', 'series')).toEqual(base);
    expect(withStyle(set, 'a', 'hud', { hidden: undefined }, 'series')).toEqual(base);
  });
});

describe('the charte', () => {
  it('merges a palette token or a font role, and forgets what goes back to the default', () => {
    const one = withCharte(base, { palette: { acc: '#ff0000' }, fonts: { title: 'fraunces' } });
    const two = withCharte(one, { palette: { ink: '#000000' } });
    expect(two.look?.charte).toEqual({ palette: { acc: '#ff0000', ink: '#000000' }, fonts: { title: 'fraunces' } });
    const three = withCharte(two, { palette: { acc: undefined, ink: undefined }, fonts: { title: undefined } });
    expect(three.look).toBeUndefined();
    expect(withCharte(two, null)).toEqual(base);
  });
});

describe('a scene’s timing', () => {
  it('sets one scene’s length and its caption window, the others untouched, and back', () => {
    const one = withSceneTiming(base, 'a', 2, { len: 6.123, cap: { a: 1, b: 0.5 } });
    expect(one.posts.a.blocks).toEqual([{}, {}, { len: 6.12, cap: { a: 1, b: 1.2 } }]);
    const two = withSceneTiming(one, 'a', 2, { len: null });
    expect(two.posts.a.blocks?.[2]).toEqual({ cap: { a: 1, b: 1.2 } });
  });
});
