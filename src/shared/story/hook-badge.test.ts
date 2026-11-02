import { describe, expect, it } from 'vitest';
import { hookBadgeContent, hookBadgeElements, hookBadgeOf, hookThemeOf, readHookBadge, roughMeasure, setInColumn, hookLayoutOf, pieceLookOf, hookBlockOf, withPostBadge, readPostBadge } from './hook-badge';
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

describe('a piece set in the Studio', () => {
  const tl = hookTimeline(hook);
  const yOf = (els: ReturnType<typeof hookBadgeElements>, piece: string) => els.find((e) => e.piece === piece)!.el.y;

  it('reads an object’s Text size as its share of the stack, the pieces under it making room', () => {
    const plain = hookBadgeElements(hook, tl, undefined, series);
    const grown = hookBadgeElements(hook, tl, undefined, series, undefined, { big: { share: 1.6 } });
    const big = grown.find((e) => e.piece === 'big')!.el;
    expect(big.sizeFrac).toBeCloseTo(0.16, 5);
    // A bottom-anchored stack grows upward: the header rises, the second line keeps clear of the big text.
    expect(yOf(grown, 'header')).toBeLessThan(yOf(plain, 'header'));
    expect(yOf(grown, 'second') - big.y).toBeGreaterThan(heightOf(0.16));
  });

  it('wears its face, ink, case and spacing, pinned against the theme', () => {
    const els = hookBadgeElements(hook, tl, undefined, series, undefined, { second: { face: { family: 'Fraunces', weight: 900, italic: false }, color: '#ff0000', textCase: 'upper', trackingPx: 4 } });
    const second = els.find((e) => e.piece === 'second')!.el;
    expect(second).toMatchObject({ fontFamily: 'Fraunces', weight: 900, color: '#ff0000', text: 'AUCUNE TRIÉE.' });
    expect(second.styleOverrides).toEqual(expect.arrayContaining(['fontFamily', 'color', 'uppercase', 'letterSpacing']));
    expect(second.letterSpacingEm).toBeGreaterThan(0);
  });

  it('maps the Studio’s settings, and nothing when none is set', () => {
    expect(pieceLookOf({}, null, null)).toBeNull();
    expect(pieceLookOf({ size: 100 }, null, null)).toBeNull();
    expect(pieceLookOf({ size: 150, textCase: 'as', tracking: 2 }, null, '#123456')).toEqual({ share: 1.5, color: '#123456', trackingPx: 2 });
  });
});

/** A size as a share of the 9:16 frame's height. */
const heightOf = (sizeFrac: number) => sizeFrac * (1080 / 1920);

describe('the shades under the badge', () => {
  it('keeps a stored stack, and measures the block a following shade lands on from the drawn layout', () => {
    const read = readHookBadge({ shades: [{ direction: 'bottom', reach: 0.4, strength: 0.7, color: '#000000', followAnchor: true }, { direction: 'nowhere' }] });
    expect(read?.shades).toHaveLength(1);
    expect(read?.shades?.[0]).toMatchObject({ direction: 'bottom', followAnchor: true });
    const tl = hookTimeline(hook);
    const block = hookBlockOf(hook, { anchor: 'top-left' }, series)!;
    const els = hookBadgeElements(hook, tl, { anchor: 'top-left' }, series);
    expect(block.anchor).toBe('top-left');
    expect(block.top).toBeCloseTo(Math.min(...els.map((e) => e.el.y)), 5);
    expect(block.bottom).toBeGreaterThan(Math.max(...els.map((e) => e.el.y)));
  });
});

describe('the cascade', () => {
  const tl = hookTimeline(hook);
  const of = (els: ReturnType<typeof hookBadgeElements>, piece: string) => els.find((e) => e.piece === piece)!.el;
  const at = (el: ReturnType<typeof of>) => el.window!.start + (el.animation!.in!.delay ?? 0);

  it('is on by default: the pieces arrive a rank apart, top to bottom, the typed lines keeping their own entry', () => {
    const els = hookBadgeElements(hook, tl, undefined, series);
    expect(of(els, 'header').animation?.in?.preset).toBe('slide');
    expect(at(of(els, 'header'))).toBeLessThan(at(of(els, 'place')));
    expect(at(of(els, 'place'))).toBeLessThan(at(of(els, 'why')));
    expect(at(of(els, 'why')) - at(of(els, 'place'))).toBeCloseTo(0.14, 5);
    expect(of(els, 'big').animation?.in?.preset).toBe('typewriter');
  });

  it('cuts at once or flickers, in the easing chosen, and cascades the typed lines too when they give up their entry', () => {
    const cut = hookBadgeElements(hook, tl, { cascade: { step: { preset: 'none', duration: 0, easing: 'linear' }, stagger: { each: 0.1, order: 'random', seed: 3 } }, keepEntry: false }, series);
    expect(cut.every((e) => e.el.animation?.in?.preset === 'none')).toBe(true);
    const flick = hookBadgeElements(hook, tl, { cascade: { step: { preset: 'flicker', duration: 0.4, easing: 'out-expo' }, stagger: { each: 0.1, order: 'sequence' } } }, series);
    expect(of(flick, 'place').animation?.in).toMatchObject({ preset: 'flicker', easing: 'out-expo' });
  });

  it('is off when set to null: each piece on its own moment, as before', () => {
    const els = hookBadgeElements(hook, tl, { cascade: null }, series);
    expect(of(els, 'place').window!.start).toBeCloseTo(tl.lines[1].done + 0.1, 5);
    expect(readHookBadge({ cascade: null, keepEntry: false })).toEqual({ cascade: null, keepEntry: false });
  });
});

describe('a post’s own place and shades', () => {
  const shade = { id: 's', direction: 'top' as const, reach: 0.4, strength: 0.6, color: '#000000', invert: false, followHook: false };
  it('wins over the series’, field by field, the rest of the series’ look kept', () => {
    const series = { look: 'pixel-crt' as const, anchor: 'bottom-left' as const, shades: [] };
    expect(withPostBadge(series, hook)).toBe(series);
    const mine = withPostBadge(series, { ...hook, badge: { anchor: 'top-right', shades: [shade] } })!;
    expect(mine).toMatchObject({ look: 'pixel-crt', anchor: 'top-right' });
    expect(mine.shades).toHaveLength(1);
    expect(withPostBadge(series, { ...hook, badge: { shades: [shade] } })!.anchor).toBe('bottom-left');
  });

  it('keeps only its place and shades when read', () => {
    expect(readPostBadge({ anchor: 'center', look: 'neutral', size: 0.2 })).toEqual({ anchor: 'center' });
    expect(readPostBadge({ look: 'neutral' })).toBeUndefined();
  });
});

describe('his own line breaks', () => {
  it('keeps them when wrapping, and breaks a long line of his inside the column', () => {
    const set = setInColumn('100 000 photos.\nAucune triée, aucune retouche, rien du tout', 'headline', 0.1, 0.86, 'wrap');
    const lines = set.text.split('\n');
    expect(lines[0]).toBe('100 000 photos.');
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(roughMeasure(l, 'headline', 0.1 * set.scale)).toBeLessThanOrEqual(0.86 + 1e-9);
  });

  it('keeps only his breaks in manual, shrinking so the widest fits, and none in one line', () => {
    const manual = setInColumn('Un\nune ligne bien plus longue que la colonne permise', 'headline', 0.1, 0.86, 'manual');
    expect(manual.text).toBe('Un\nune ligne bien plus longue que la colonne permise');
    expect(roughMeasure('une ligne bien plus longue que la colonne permise', 'headline', 0.1 * manual.scale)).toBeCloseTo(0.86, 5);
    expect(setInColumn('Un\ndeux', 'headline', 0.1, 0.86, 'fit').text).toBe('Un deux');
  });

  it('lets his breaks outnumber the line limit, and the limit be set', () => {
    expect(setInColumn('a\nb\nc\nd\ne', 'headline', 0.1, 0.86, 'wrap').text.split('\n')).toHaveLength(5);
    const long = 'J’ai roulé quatorze mille kilomètres en van sans jamais trier une photo';
    expect(setInColumn(long, 'headline', 0.2, 0.86, 'wrap', roughMeasure, 5).text.split('\n').length).toBeLessThanOrEqual(5);
    expect(setInColumn(long, 'headline', 0.2, 0.86, 'wrap', roughMeasure, 1).text.split('\n')).toHaveLength(1);
  });

  it('spaces the lines as set, and reads the settings field by field', () => {
    const h: Hook = { lines: ['Un\ndeux', 'Aucune.'] };
    const tl = hookTimeline(h);
    const gap = (leading?: number) => {
      const big = hookBadgeElements(h, tl, { long: 'manual', leading }, series).filter((e) => e.piece === 'big').map((e) => e.el.y);
      return big[1] - big[0];
    };
    expect(gap(0.6)).toBeGreaterThan(gap(0));
    expect(readHookBadge({ long: 'manual', maxLines: 9, leading: 2 })).toEqual({ long: 'manual', maxLines: 6, leading: 0.8 });
  });
});

