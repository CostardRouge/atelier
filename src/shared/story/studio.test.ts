import { describe, expect, it } from 'vitest';
import './blocks/all';
import { assemble, SCRIPT_KIND, type PostSkeleton, type StoryScript } from './story-script';
import { objectLabel, objectTracks, sceneSpans } from './studio';

const skeleton: PostSkeleton = {
  id: 'p',
  number: 'EP.09',
  season: 1,
  blocks: [
    { block: 'counter', len: 4, cap: { a: 0.5, b: 3.5 } },
    { block: 'clocks', len: 5, cap: null },
  ],
};

describe('objectTracks', () => {
  it('lists every object a post draws, by slot, with when it is on the stage', () => {
    const ep = assemble(skeleton, { kind: SCRIPT_KIND, version: 1, posts: { p: { title: 'Neuf' } } }, [skeleton]);
    const tracks = objectTracks(ep, {}, 0.2);
    const ids = tracks.map((t) => t.id);
    expect(ids).toContain('0-intro:intro');
    expect(ids).toContain('1-counter:counter');
    expect(ids).toContain('1-counter:caption');
    expect(ids).toContain(':hud');
    expect(ids).toContain('3-recap-carte:recap-carte');
    const counter = tracks.find((t) => t.id === '1-counter:counter')!;
    const [a, b] = counter.spans[0];
    // The counter's slot runs from the title's end, overlapped by the transition, for its four seconds.
    expect(a).toBeGreaterThan(2);
    expect(b).toBeLessThan(9);
    expect(counter.text).toBe(true);
    const caption = tracks.find((t) => t.id === '1-counter:caption')!;
    expect(caption.spans[0][0]).toBeGreaterThanOrEqual(a);
  });

  it('follows a post’s own scene length', () => {
    const script: StoryScript = { kind: SCRIPT_KIND, version: 1, posts: { p: { blocks: [{ len: 8 }] } } };
    const long = objectTracks(assemble(skeleton, script, [skeleton]), {}, 0.2).find((t) => t.id === '1-counter:counter')!;
    const short = objectTracks(assemble(skeleton, null, [skeleton]), {}, 0.2).find((t) => t.id === '1-counter:counter')!;
    expect(long.spans[0][1] - long.spans[0][0]).toBeGreaterThan(short.spans[0][1] - short.spans[0][0] + 3);
  });
});

describe('sceneSpans', () => {
  it('names each slot by its block and its place among the post’s blocks', () => {
    const scenes = sceneSpans(assemble(skeleton, null, [skeleton]));
    expect(scenes.map((s) => [s.block, s.index])).toEqual([
      ['intro', null],
      ['counter', 0],
      ['clocks', 1],
      ['recap-carte', null],
    ]);
  });
});

describe('objectLabel', () => {
  it('names a scene by its block and a part by its last name', () => {
    expect(objectLabel('map-camera')).toBe('Map');
    expect(objectLabel('counter.number')).toBe('Number');
    expect(objectLabel('season-recap.cover-line')).toBe('Cover line');
    expect(objectLabel('hud')).toBe('HUD');
  });
});
