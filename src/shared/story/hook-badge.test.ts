import { describe, expect, it } from 'vitest';
import { hookBadgeContent, hookBadgeElements, hookBadgeOf, hookThemeOf, readHookBadge, roughMeasure, setInColumn, hookLayoutOf } from './hook-badge';
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
    expect(readHookBadge({ look: 'pixel-crt', composition: 'nope', size: 9, pieces: { why: false, x: true } })).toEqual({ look: 'pixel-crt', size: 0.3, pieces: { why: false } });
    expect(hookThemeOf(undefined).presetId).toBe('or-cine');
    expect(hookThemeOf({ look: 'plein-cadre' }).style.uppercase).toBe(true);
  });
});

describe('the big text set in a column', () => {
  const long = 'J’ai roulé quatorze mille kilomètres en van sans jamais trier une photo';

  it('breaks a sentence at words so no line runs past the column', () => {
    const set = setInColumn(long, 'headline', 0.1, 0.86, 'wrap');
    const lines = set.text.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(roughMeasure(l, 'headline', 0.1 * set.scale)).toBeLessThanOrEqual(0.86 + 1e-9);
    expect(lines.join(' ')).toBe(long);
  });

  it('shrinks past three lines rather than grow into a paragraph, and keeps one line in fit', () => {
    const big = setInColumn(long, 'headline', 0.25, 0.86, 'wrap');
    expect(big.text.split('\n').length).toBeLessThanOrEqual(3);
    expect(big.scale).toBeLessThan(1);
    const fit = setInColumn(long, 'headline', 0.1, 0.86, 'fit');
    expect(fit.text).not.toContain('\n');
    expect(roughMeasure(fit.text, 'headline', 0.1 * fit.scale)).toBeCloseTo(0.86, 5);
  });

  it('leaves a short line as it is', () => {
    expect(setInColumn('100 000 photos.', 'headline', 0.1, 0.86, 'wrap')).toEqual({ text: '100 000 photos.', scale: 1 });
  });

  it('types a broken big text line after line, and stacks the second line under the last', () => {
    const h: Hook = { lines: [long, 'Aucune triée.'] };
    const tl = hookTimeline(h);
    const els = hookBadgeElements(h, tl, { size: 0.12 }, series).filter((e) => e.piece === 'big').map((e) => e.el);
    expect(els.length).toBeGreaterThan(1);
    for (let i = 1; i < els.length; i++) {
      expect(els[i].window!.start).toBeGreaterThan(els[i - 1].window!.start);
      expect(els[i].y).toBeGreaterThan(els[i - 1].y);
    }
    const last = els[els.length - 1];
    expect(last.window!.start + last.animation!.in!.duration).toBeCloseTo(tl.lines[0].done, 5);
    const second = hookBadgeElements(h, tl, { size: 0.12 }, series).find((e) => e.piece === 'second')!.el;
    expect(second.y).toBeGreaterThan(last.y);
  });
});

describe('where the badge sits', () => {
  it('takes the composition’s place until the grid sets an anchor, then that cell’s point at the numeral', () => {
    expect(hookLayoutOf(hookBadgeOf(undefined))).toMatchObject({ anchor: 'bottom-left', x: 0.07, y: 0.8, sizeFrac: 0.1 });
    expect(hookLayoutOf(hookBadgeOf({ composition: 'centre', size: 0.2 }))).toMatchObject({ anchor: 'center', sizeFrac: 0.2 });
    expect(hookLayoutOf(hookBadgeOf({ anchor: 'top-right' }))).toMatchObject({ anchor: 'top-right', x: 0.93, y: 0.1 });
    expect(hookLayoutOf(hookBadgeOf({ anchor: 'top-right', x: 0.8, y: 0.2 }))).toMatchObject({ x: 0.8, y: 0.2 });
  });

  it('moves every piece with the anchor, and reads a stored one field by field', () => {
    const tl = hookTimeline(hook);
    const els = hookBadgeElements(hook, tl, { anchor: 'top-center' }, series);
    expect(els.every((e) => e.el.anchor === 'top-center' && e.el.x === 0.5)).toBe(true);
    expect(Math.min(...els.map((e) => e.el.y))).toBeCloseTo(0.1, 5);
    expect(readHookBadge({ anchor: 'nowhere', x: 2, y: 0.3 })).toEqual({ x: 1, y: 0.3 });
    expect(readHookBadge({ anchor: 'bottom-right' })).toEqual({ anchor: 'bottom-right' });
  });
});

