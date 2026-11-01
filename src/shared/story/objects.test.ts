import { afterEach, describe, expect, it } from 'vitest';
import { PAL, TYPO } from './charte';
import {
  applyCharte,
  beginFrame,
  colorOf,
  currentStyle,
  drawnObjects,
  hideObject,
  markText,
  obj,
  readCharte,
  readStyle,
  readStyleBook,
  resolveFont,
  setSlot,
  setStyles,
} from './objects';

/** A canvas context that only records what the object layer asks of it. */
function fakeCtx() {
  const calls: string[] = [];
  const c = {
    globalAlpha: 1,
    shadowBlur: 0,
    shadowOffsetY: 0,
    shadowColor: '',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => calls.push(`translate ${x} ${y}`),
    rotate: (a: number) => calls.push(`rotate ${a.toFixed(3)}`),
    scale: (x: number) => calls.push(`scale ${x}`),
  };
  return { c: c as unknown as CanvasRenderingContext2D, calls };
}

afterEach(() => {
  applyCharte(null);
  setStyles(null, null);
  hideObject(null);
  beginFrame();
});

describe('reading settings from a script', () => {
  it('keeps each field in its bounds and drops what is not a setting', () => {
    expect(readStyle({ dx: 12, scale: 9, opacity: -1, font: '@title', color: '@acc', weight: 'bold', textCase: 'upper', delay: 0.4 })).toEqual({
      dx: 12,
      scale: 5,
      opacity: 0,
      font: '@title',
      color: '@acc',
      textCase: 'upper',
      delay: 0.4,
    });
    expect(readStyle({ font: 'comic-sans', color: 'red', outlineColor: '#12345' })).toBeUndefined();
    expect(readStyle({ font: 'fraunces', color: '#AbCdEf' })).toEqual({ font: 'fraunces', color: '#AbCdEf' });
  });

  it('keeps a book by dotted keys only', () => {
    expect(readStyleBook({ 'counter.number': { size: 120 }, 'Bad Key': { size: 90 }, caption: { hidden: true }, hud: {} })).toEqual({
      'counter.number': { size: 120 },
      caption: { hidden: true },
    });
  });

  it('keeps a charte’s hex colours, known faces and weights', () => {
    expect(readCharte({ palette: { acc: '#FF0000', ink: 'black' }, fonts: { title: 'fraunces', text: 'nope' }, titleWeight: 900 })).toEqual({
      palette: { acc: '#ff0000' },
      fonts: { title: 'fraunces' },
      titleWeight: 900,
    });
    expect(readCharte({})).toBeUndefined();
  });
});

describe('the charte', () => {
  it('sets the palette for the frames that follow, and back', () => {
    const was = PAL.acc;
    applyCharte({ palette: { acc: '#ff0000' } });
    expect(PAL.acc).toBe('#ff0000');
    expect(colorOf('@acc', '#000000')).toBe('#ff0000');
    applyCharte(null);
    expect(PAL.acc).toBe(was);
  });

  it('reads a colour as a token or a hex, else the code’s own', () => {
    expect(colorOf('@ink', 'x')).toBe(PAL.ink);
    expect(colorOf('#123456', 'x')).toBe('#123456');
    expect(colorOf('@nope', 'x')).toBe('x');
    expect(colorOf(undefined, 'x')).toBe('x');
  });

  it('sets the code’s sans in the title face at title weights and the text face below, its mono in the numbers face', () => {
    expect(resolveFont(40, TYPO.hw, TYPO.fam)).toContain('Geist');
    applyCharte({ fonts: { title: 'fraunces', text: 'instrument', num: 'vt323' }, titleWeight: 900 });
    expect(resolveFont(40, TYPO.hw, TYPO.fam)).toBe(`900 40px Fraunces, Georgia, serif`);
    expect(resolveFont(40, TYPO.lw, TYPO.fam)).toBe(`400 40px "Instrument Serif", Georgia, serif`);
    expect(resolveFont(20, 400, TYPO.mono)).toContain('VT323');
    // A family the code names itself is left alone.
    expect(resolveFont(20, 400, 'Georgia')).toBe('400 20px Georgia');
  });
});

describe('drawing an object', () => {
  it('moves, turns, sizes and fades it about its anchor, and draws at its delayed time', () => {
    setStyles({ 'counter.number': { dx: 10, scale: 2, rotate: 90, opacity: 0.5, delay: 1 } }, null);
    const { c, calls } = fakeCtx();
    let at = -1;
    obj(c, 'counter.number', [540, 1000], 3, (t) => (at = t));
    expect(at).toBe(2);
    expect(calls).toEqual(['save', 'translate 10 0', 'translate 540 1000', 'rotate 1.571', 'scale 2', 'translate -540 -1000', 'restore']);
    expect(c.globalAlpha).toBe(0.5);
  });

  it('lets the post’s settings win over the series’', () => {
    setStyles({ caption: { size: 80, color: '@acc' } }, { caption: { size: 120 } });
    const { c } = fakeCtx();
    let seen = null as ReturnType<typeof currentStyle>;
    obj(c, 'caption', [0, 0], 0, () => (seen = currentStyle()));
    expect(seen).toMatchObject({ size: 120, color: '@acc' });
  });

  it('hands a scene’s typography down to its parts, the part’s own winning', () => {
    setStyles({ counter: { font: 'fraunces', color: '@acc' }, 'counter.label': { color: '#000000' } }, null);
    const { c } = fakeCtx();
    let inner = null as ReturnType<typeof currentStyle>;
    obj(c, 'counter', [540, 960], 0, () => obj(c, 'counter.label', [540, 1090], 0, () => (inner = currentStyle())));
    expect(inner).toMatchObject({ font: 'fraunces', color: '#000000' });
  });

  it('lists what a frame drew, by slot, in order, and marks the ones that set text', () => {
    beginFrame();
    const { c } = fakeCtx();
    setSlot('1-counter');
    obj(c, 'counter', [540, 960], 0, () => obj(c, 'counter.number', [540, 1000], 0, () => markText()));
    setSlot('');
    obj(c, 'hud', [540, 214], 0, () => {});
    expect(drawnObjects()).toEqual([
      { id: '1-counter:counter', key: 'counter', slot: '1-counter', text: true },
      { id: '1-counter:counter.number', key: 'counter.number', slot: '1-counter', text: true },
      { id: ':hud', key: 'hud', slot: '', text: false },
    ]);
  });

  it('draws nothing for a hidden object, nor for the one left out to pick, but still lists it', () => {
    setStyles({ hud: { hidden: true } }, null);
    beginFrame();
    const { c, calls } = fakeCtx();
    let drew = 0;
    obj(c, 'hud', [0, 0], 0, () => drew++);
    setSlot('0-wall');
    hideObject('0-wall:wall');
    obj(c, 'wall', [0, 0], 0, () => drew++);
    expect(drew).toBe(0);
    expect(calls).toEqual([]);
    expect(drawnObjects().map((d) => d.id)).toEqual([':hud', '0-wall:wall']);
  });
});
