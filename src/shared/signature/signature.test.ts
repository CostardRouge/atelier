import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOC_SIGNATURE,
  DEFAULT_SIGNATURE_STYLE,
  END_CARD_SECONDS,
  cubicBezier,
  endCardBeat,
  placeOf,
  readDocSignature,
  readSignatureStyle,
  signatureLine,
  signatureParts,
  signedSlides,
  withCorner,
  withPlace,
} from './signature';

describe('signatureParts / signatureLine', () => {
  it('says the brand alone, the tool after it, or the address too', () => {
    expect(signatureLine('made', 'Recap')).toBe('Made with Atelier');
    expect(signatureLine('tool', 'Recap')).toBe('Made with Atelier · Recap');
    expect(signatureLine('address', 'Flight Atlas')).toBe('Made with Atelier · Flight Atlas · atelier.steeve.website');
  });

  it('leaves the tool and the address null where the words do not say them', () => {
    expect(signatureParts('made', 'Mosaic')).toEqual({ lead: 'Made with', name: 'Atelier', tool: null, address: null });
    expect(signatureParts('tool', 'Mosaic').address).toBeNull();
    expect(signatureParts('address', 'Mosaic').tool).toBe('Mosaic');
  });
});

describe('signedSlides', () => {
  it('is the last slide by default', () => {
    expect([...signedSlides(5, 'last')]).toEqual([4]);
    expect([...signedSlides(1, 'last')]).toEqual([0]);
  });

  it('is every slide, or the two ends', () => {
    expect([...signedSlides(3, 'every')]).toEqual([0, 1, 2]);
    expect([...signedSlides(4, 'ends')].sort()).toEqual([0, 3]);
    expect([...signedSlides(1, 'ends')]).toEqual([0]);
  });

  it('signs nothing of nothing', () => {
    expect(signedSlides(0, 'every').size).toBe(0);
  });
});

describe('readDocSignature', () => {
  it('gives a document that never chose its tool’s default', () => {
    expect(readDocSignature(undefined)).toEqual(DEFAULT_DOC_SIGNATURE);
    expect(readDocSignature(null, { on: false, corner: 'br', slides: 'last' })).toEqual({ on: false, corner: 'br', slides: 'last' });
  });

  it('keeps what is valid and mends the rest', () => {
    expect(readDocSignature({ on: false, corner: 'tr', slides: 'every' })).toEqual({ on: false, corner: 'tr', slides: 'every' });
    expect(readDocSignature({ on: 'yes', corner: 'middle', slides: 3 })).toEqual(DEFAULT_DOC_SIGNATURE);
  });
});

describe('readSignatureStyle', () => {
  it('is the sticker saying the tool until something else is kept', () => {
    expect(readSignatureStyle(null)).toEqual(DEFAULT_SIGNATURE_STYLE);
    expect(readSignatureStyle({ face: 'stamp', words: 'made' })).toEqual({ face: 'stamp', words: 'made' });
    expect(readSignatureStyle({ face: 'banner', words: 'loud' })).toEqual(DEFAULT_SIGNATURE_STYLE);
  });
});

describe('cubicBezier', () => {
  it('holds its two ends and follows a straight line', () => {
    const linear = cubicBezier(0.25, 0.25, 0.75, 0.75);
    expect(linear(0)).toBe(0);
    expect(linear(1)).toBe(1);
    expect(linear(0.4)).toBeCloseTo(0.4, 3);
  });

  it('overshoots where its control point does', () => {
    const pop = cubicBezier(0.3, 1.6, 0.5, 1);
    expect(Math.max(...[0.3, 0.4, 0.5, 0.6, 0.7].map(pop))).toBeGreaterThan(1);
  });
});

describe('endCardBeat', () => {
  it('starts with nothing drawn', () => {
    expect(endCardBeat(0)).toEqual({ corners: 0, dot: 0, words: [0, 0, 0, 0] });
  });

  it('brings the corners home before the dot, the dot before the words', () => {
    const mid = endCardBeat(0.3);
    expect(mid.corners).toBeGreaterThan(0.8);
    expect(mid.dot).toBe(0);
    expect(mid.words[0]).toBe(0);
    const later = endCardBeat(0.55);
    expect(later.dot).toBeGreaterThan(0.5);
    expect(later.words[0]).toBeGreaterThan(later.words[3]);
  });

  it('has landed whole before the film ends', () => {
    const end = endCardBeat(END_CARD_SECONDS - 0.15);
    expect(end.corners).toBe(1);
    expect(end.dot).toBeCloseTo(1, 5);
    expect(end.words).toEqual([1, 1, 1, 1]);
  });
});

describe('a mark placed by hand', () => {
  it('is a slide’s own, the others keeping the corner', () => {
    const moved = withPlace(DEFAULT_DOC_SIGNATURE, { x: 0.7, y: 0.2 }, 'p:3');
    expect(placeOf(moved, 'p:3')).toEqual({ x: 0.7, y: 0.2 });
    expect(placeOf(moved, 'p:4')).toBeNull();
    expect(placeOf(moved)).toBeNull();
  });

  it('is the whole document’s where no slide is named, under a slide’s own', () => {
    const one = withPlace(DEFAULT_DOC_SIGNATURE, { x: 0.5, y: 0.5 });
    expect(placeOf(one)).toEqual({ x: 0.5, y: 0.5 });
    expect(placeOf(one, 'first')).toEqual({ x: 0.5, y: 0.5 });
    expect(placeOf(withPlace(one, { x: 0.1, y: 0.9 }, 'first'), 'first')).toEqual({ x: 0.1, y: 0.9 });
  });

  it('signs a document that was not, and stays inside the frame', () => {
    const moved = withPlace({ ...DEFAULT_DOC_SIGNATURE, on: false }, { x: 1.4, y: -0.2 });
    expect(moved.on).toBe(true);
    expect(moved.at).toEqual({ x: 1, y: 0 });
  });

  it('is let go, everywhere, by a corner picked', () => {
    const moved = withPlace(withPlace(DEFAULT_DOC_SIGNATURE, { x: 0.3, y: 0.3 }), { x: 0.6, y: 0.6 }, 'first');
    expect(withCorner(moved, 'tr')).toEqual({ on: true, corner: 'tr', slides: 'last' });
  });

  it('survives storage, and a broken place is dropped', () => {
    const moved = withPlace(withPlace(DEFAULT_DOC_SIGNATURE, { x: 0.25, y: 0.75 }), { x: 0.6, y: 0.4 }, 'first');
    expect(readDocSignature(JSON.parse(JSON.stringify(moved)))).toEqual(moved);
    const read = readDocSignature({ on: true, corner: 'bl', slides: 'last', at: { x: 'left', y: 0 }, places: { a: { x: 0.5 }, b: { x: 0.2, y: 0.8 } } });
    expect(read.at).toBeUndefined();
    expect(read.places).toEqual({ b: { x: 0.2, y: 0.8 } });
  });
});
