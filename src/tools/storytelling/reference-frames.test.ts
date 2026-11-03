import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawEpisode } from '../../shared/story/compose';
import { slotsOf, totalSeconds } from '../../shared/story/episode';
import { fingerprint, recordingContext, RecordingPath2D } from '../../shared/story/recording-context';
import { assemble, newScript, type StoryScript } from '../../shared/story/story-script';
import { POSTS } from './posts';

/**
 * The REFERENCE FRAMES (strategy R5): every post of the series drawn at fixed
 * moments — each scene soon after it lands, at its middle and as it leaves,
 * the hook as it types and as it settles — from a neutral sample script, its
 * paints written down by `recordingContext` and compared with the snapshot
 * beside this file. A block whose layout drifts (the badge that crushed its
 * pieces, a caption that climbed, a part left out) changes a frame's
 * fingerprint and the words it paints, and the diff names the post and the
 * moment. A change MEANT is accepted with `npm run frames -- -u`; one not
 * meant is a regression found before an export.
 */

const SAMPLE: StoryScript = {
  ...newScript('Sample series', 'en'),
  handle: '@sample',
  ask: 'Follow for the next one',
  posts: Object.fromEntries(
    POSTS.map((p, i) => [
      p.id,
      {
        title: `Post ${i}`,
        hooks: i % 2 === 0 ? [{ lines: ['Ten thousand pictures and one long road.', 'One trip.'] }] : undefined,
        blocks: p.blocks.map((_, k) => ({ caption: `Caption ${k + 1} of post ${i}, long enough to wrap on two lines` })),
      },
    ]),
  ),
};

/** The moments a post is looked at, seconds on its clock. */
function moments(id: string): number[] {
  const ep = assemble(POSTS.find((p) => p.id === id)!, SAMPLE, POSTS);
  const end = totalSeconds(ep) - 0.001;
  const at = new Set<number>([0.3, 1.2]);
  for (const s of slotsOf(ep)) for (const t of [s.a + 0.5, (s.a + s.b) / 2, s.b - 0.2]) at.add(Math.round(Math.min(end, Math.max(0, t)) * 100) / 100);
  return [...at].sort((a, b) => a - b);
}

describe('reference frames', () => {
  beforeAll(() => {
    // The hook's « why now » counts to today: the frames are drawn on one fixed day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    // Node has no Path2D; the recording one keeps its points for the box.
    if (typeof globalThis.Path2D === 'undefined') vi.stubGlobal('Path2D', RecordingPath2D);
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  for (const post of POSTS) {
    it(`${post.number} draws as it did`, () => {
      const ep = assemble(post, SAMPLE, POSTS);
      const frames = moments(post.id).map((t) => {
        const rec = recordingContext();
        drawEpisode(rec.ctx, ep, t, { dry: true });
        const words = rec.texts.join(' / ');
        return `${t.toFixed(2)}s ${rec.ops.length} ops ${fingerprint(rec.ops)} | ${words.length > 140 ? `${words.slice(0, 140)}…` : words}`;
      });
      expect(frames).toMatchSnapshot();
    });
  }

  it('the living wall (Metro, smart) draws as it did, and settles aligned', () => {
    const post = POSTS[0];
    const ep = assemble(post, { ...SAMPLE, look: { wallMotion: { preset: 'metro' } } }, POSTS);
    const wall = slotsOf(ep).find((s) => s.block === 'wall')!;
    const frames = [0.8, 1.3, 1.8, 2.6].map((lt) => {
      const rec = recordingContext();
      drawEpisode(rec.ctx, ep, wall.start + lt, { dry: true, cues: { beats: [wall.start + 1.2, wall.start + 1.6], speech: [[wall.start + 1.0, wall.start + 1.4]] } });
      return `${lt.toFixed(2)}s ${rec.ops.length} ops ${fingerprint(rec.ops)}`;
    });
    expect(frames).toMatchSnapshot();
  });

  it('his own pictures in the blocks (gear, the app’s grid) draw as they did', () => {
    const post = POSTS.find((p) => p.blocks.some((b) => b.block === 'gear'))!;
    const gear = post.blocks.findIndex((b) => b.block === 'gear');
    const script: StoryScript = {
      ...SAMPLE,
      facts: { at: '2025-01-01T00:00:00Z', values: {}, devicePics: { 'gear.camera': 7 } },
      posts: { ...SAMPLE.posts, [post.id]: { ...SAMPLE.posts[post.id], blocks: post.blocks.map((_, k) => (k === gear ? { params: { devices: [{ name: 'Camera', kind: 'camera' }, { name: 'Drone', kind: 'drone' }] } } : {})) } },
    };
    const ep = assemble(post, script, POSTS);
    const slot = slotsOf(ep).find((s) => s.block === 'gear')!;
    const picture = { width: 400, height: 300 } as unknown as CanvasImageSource;
    const rec = recordingContext();
    drawEpisode(rec.ctx, ep, slot.start + 2.5, { dry: true, pictures: new Map([[7, picture]]), wall: [picture] });
    const images = rec.ops.filter((o) => o.startsWith('image'));
    // The camera's picture in its card; the drone, with none, keeps its silhouette.
    expect(images.length).toBe(1);
    expect([`${rec.ops.length} ops ${fingerprint(rec.ops)}`, ...images]).toMatchSnapshot();
  });

  it('a developed picture in the before/after: the original, then the final wiped in', () => {
    const post = POSTS.find((p) => p.blocks.some((b) => b.block === 'before-after'))!;
    const script: StoryScript = { ...SAMPLE, facts: { at: '2025-01-01T00:00:00Z', values: {}, edits: [[1, 2]] } };
    const ep = assemble(post, script, POSTS);
    const slot = slotsOf(ep).find((s) => s.block === 'before-after')!;
    const pic = (w: number) => ({ width: w, height: 800 }) as unknown as CanvasImageSource;
    const frames = [1.0, 2.6, 3.4].map((lt) => {
      const rec = recordingContext();
      drawEpisode(rec.ctx, ep, slot.start + lt, { dry: true, prints: new Map([[1, pic(1200)], [2, pic(1201)]]) });
      return `${lt.toFixed(2)}s ${rec.ops.filter((o) => o.startsWith('image')).length} images ${fingerprint(rec.ops)}`;
    });
    expect(frames[0]).toMatch(/ 1 images /);
    expect(frames[2]).toMatch(/ 2 images /);
    expect(frames).toMatchSnapshot();
  });

  it('the same frame records the same, and a part moved is seen', () => {
    const post = POSTS[0];
    const draw = (dx: number) => {
      const ep = assemble(post, { ...SAMPLE, look: { objects: { caption: { dx } } } }, POSTS);
      const rec = recordingContext();
      drawEpisode(rec.ctx, ep, slotsOf(ep)[1].a + 1, { dry: true });
      return fingerprint(rec.ops);
    };
    expect(draw(0)).toBe(draw(0));
    expect(draw(0)).not.toBe(draw(10));
  });
});
