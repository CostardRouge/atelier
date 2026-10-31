import { describe, expect, it } from 'vitest';
import { slotsOf } from './episode';
import { hookScore, hookSounds, hookTimeline, type Hook } from './hook';
import { assemble, parseScript, SCRIPT_KIND, type PostSkeleton } from './story-script';

const chosen: Hook = { lines: ['100 000 photos.', 'Aucune triée.'] };

describe('hookTimeline', () => {
  it('types the first line letter by letter, then lands the second as a sticker', () => {
    const tl = hookTimeline(chosen);
    const [typed, sticker] = tl.lines;
    expect(typed.sticker).toBe(false);
    expect(typed.start).toBe(0.15);
    // 15 characters at 14 a second, one key per non-space character.
    expect(typed.done).toBeCloseTo(0.15 + 15 / 14);
    expect(typed.keys).toHaveLength(13);
    expect(sticker.sticker).toBe(true);
    expect(sticker.start).toBeCloseTo(typed.done + 1.1);
    expect(sticker.keys).toEqual([]);
    expect(tl.leave).toBeCloseTo(sticker.done + 0.6);
    expect(tl.end).toBeGreaterThan(tl.leave);
  });

  it('honours the hook’s own timing and a cut exit', () => {
    const tl = hookTimeline({ lines: ['Un'], at: 1, cps: 2, hold: 0, exit: 'cut', sticker: null });
    expect(tl.lines[0].done).toBe(2);
    expect(tl.end).toBe(tl.leave);
  });
});

describe('hookSounds', () => {
  it('clicks each typed letter, hits once on the sticker, breathes out on the exit', () => {
    const s = hookSounds(chosen);
    expect(s.filter((x) => x.kind === 'keys')).toHaveLength(13);
    expect(s.filter((x) => x.kind === 'impact')).toHaveLength(1);
    expect(s.filter((x) => x.kind === 'whoosh')).toHaveLength(1);
    const keys = s.filter((x) => x.kind === 'keys');
    expect(new Set(keys.map((k) => k.gain.toFixed(3))).size).toBeGreaterThan(1);
  });

  it('plays built-in voices only, leaving a file sound or none to the editor', () => {
    const score = hookScore({ ...chosen, sounds: { keys: 'typewriter', impact: 'file', whoosh: 'none' } });
    expect(score.every((e) => e.voice === 'typewriter')).toBe(true);
    expect(score).toHaveLength(13);
  });
});

describe('a post with a hook', () => {
  const skeleton: PostSkeleton = { id: 'a', number: 'EP.00', season: 1, blocks: [{ block: 'wall', len: 4.4, cap: null }, { block: 'map-camera', len: 5, cap: null }] };

  it('reads its hooks from a script file, dropping what is not well formed', () => {
    const parsed = parseScript({
      kind: SCRIPT_KIND,
      version: 1,
      posts: { a: { hooks: [{ lines: ['{media.total} photos.', 'Aucune triée.'], entry: 'type', exit: 'shatter', cps: 400 }, { lines: [] }], hookActive: 3, promise: 'La méthode, épisode par épisode.' } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const post = parsed.script.posts.a;
    expect(post.hooks).toEqual([{ lines: ['{media.total} photos.', 'Aucune triée.'], entry: 'type', cps: 60, sounds: {} }]);
    expect(post.hookActive).toBe(0);
    expect(post.promise).toBe('La méthode, épisode par épisode.');
  });

  it('opens on its first block, the hook over it, the wall quiet and the facts filled in', () => {
    const ep = assemble(
      skeleton,
      { kind: SCRIPT_KIND, version: 1, facts: { at: 'x', values: { 'media.total': 98412 } }, posts: { a: { hooks: [{ lines: ['{media.total} photos.'] }] } } },
      [skeleton],
    );
    expect(ep.hook?.lines[0]).toMatch(/^98\s412 photos\.$/u);
    expect(ep.blocks[0].params?.quiet).toBe(true);
    expect(slotsOf(ep)[0].block).toBe('wall');
  });

  it('keeps the title opening without a hook', () => {
    const ep = assemble(skeleton, null, [skeleton]);
    expect(ep.hook).toBeNull();
    expect(slotsOf(ep)[0].block).toBe('intro');
    expect(ep.blocks[0].params?.quiet).toBeUndefined();
  });
});
