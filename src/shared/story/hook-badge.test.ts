import { describe, expect, it } from 'vitest';
import { hookBadgeContent, hookBadgeElements, hookBadgeOf, hookThemeOf, readHookBadge } from './hook-badge';
import { hookTimeline, type Hook } from './hook';

const hook: Hook = { lines: ['100 000 photos.', 'Aucune triée.'] };
const series = { series: 'Le tri d’Australie', number: 'EP.04', from: 'Perth', to: 'Cairns', since: '2025-01-02', today: '2026-01-02', lang: 'fr' as const };

describe('the hook as Trips’ badge', () => {
  it('fills the pieces from the post and the series, a post’s own text winning', () => {
    const c = hookBadgeContent(hook, hookBadgeOf(undefined), series);
    expect(c).toMatchObject({ kicker: 'Le tri d’Australie · EP.04', headline: '100 000 photos.', counter: 'Aucune triée.', caption: '◆ Perth → Cairns', exif: null });
    expect(c.timing).toMatch(/an/);
    const own = hookBadgeContent({ ...hook, pieces: { camera: 'Sony A7C II', place: 'Lucky Bay' } }, hookBadgeOf({ pieces: { why: false } }), series);
    expect(own).toMatchObject({ exif: 'Sony A7C II', caption: 'Lucky Bay', timing: null });
  });

  it('times each piece on the hook’s own clock: the big text typed as the first line, the second popping on its beat', () => {
    const tl = hookTimeline(hook);
    const els = hookBadgeElements(hook, tl, undefined, series);
    const big = els.find((e) => e.piece === 'big')!.el;
    expect(big.window?.start).toBeCloseTo(tl.lines[0].start, 5);
    expect(big.animation?.in?.preset).toBe('typewriter');
    expect(big.animation?.in?.duration).toBeCloseTo(tl.lines[0].done - tl.lines[0].start, 5);
    const second = els.find((e) => e.piece === 'second')!.el;
    expect(second.window?.start).toBeCloseTo(tl.lines[1].start, 5);
    expect(els.every((e) => e.el.window?.end === tl.end)).toBe(true);
    expect(els.map((e) => e.piece)).toEqual(['header', 'big', 'second', 'place', 'why']);
  });

  it('lays the title up and the card down, keeping each piece’s name', () => {
    const els = hookBadgeElements(hook, hookTimeline(hook), { composition: 'split' }, series);
    const by = Object.fromEntries(els.map((e) => [e.piece, e.el]));
    expect(by.big.y).toBeLessThan(0.3);
    expect(by.place.y).toBeGreaterThan(0.6);
  });

  it('keeps a look field by field, and its tuned theme over the preset', () => {
    expect(readHookBadge({ look: 'pixel-crt', composition: 'nope', size: 9, pieces: { why: false, x: true } })).toEqual({ look: 'pixel-crt', size: 0.2, pieces: { why: false } });
    expect(hookThemeOf(undefined).presetId).toBe('or-cine');
    expect(hookThemeOf({ look: 'plein-cadre' }).style.uppercase).toBe(true);
  });
});
