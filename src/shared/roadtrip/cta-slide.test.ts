import { describe, expect, it } from 'vitest';
import { DEFAULT_CTA, ctaLayout, type CtaSlide } from './cta-slide';

const REEL = 9 / 16;
const SQUARE = 1;
const PORTRAIT = 4 / 5;

const cta = (over: Partial<CtaSlide> = {}): CtaSlide => ({ ...DEFAULT_CTA, ...over });

describe('ctaLayout', () => {
  it('lays out headline, body and url as text', () => {
    const { elements } = ctaLayout(cta(), PORTRAIT);
    const joined = elements.map((e) => e.text).join(' ');
    expect(joined).toContain(DEFAULT_CTA.headline);
    expect(joined).toContain(DEFAULT_CTA.url);
    // The body arrives wrapped, so it is compared word by word.
    for (const word of DEFAULT_CTA.body.split(' ')) expect(joined).toContain(word);
  });

  it('wraps a sentence instead of running it off the frame', () => {
    // The engine draws one line per element and never wraps by itself; the
    // first cut of this card overflowed both edges.
    const { elements } = ctaLayout(cta(), PORTRAIT);
    expect(elements.length).toBeGreaterThan(3);
    for (const el of elements) expect(el.text!.length).toBeLessThan(60);
  });

  it('wraps harder on a narrower frame', () => {
    const wide = ctaLayout(cta(), 16 / 9).elements.length;
    const narrow = ctaLayout(cta(), REEL).elements.length;
    expect(narrow).toBeGreaterThanOrEqual(wide);
  });

  it('keeps a line break the author typed', () => {
    const { elements } = ctaLayout(
      cta({ headline: 'One\nTwo', body: '', url: '', showQr: false }),
      PORTRAIT,
    );
    expect(elements.map((e) => e.text)).toEqual(['One', 'Two']);
  });

  it('stacks them down the frame without overlapping', () => {
    const { elements } = ctaLayout(cta(), PORTRAIT);
    for (let i = 1; i < elements.length; i++) {
      expect(elements[i].y).toBeGreaterThan(elements[i - 1].y);
    }
  });

  it('makes the headline the biggest line', () => {
    const { elements } = ctaLayout(cta(), PORTRAIT);
    const [headline, ...rest] = elements;
    for (const el of rest) expect(el.sizeFrac).toBeLessThanOrEqual(headline.sizeFrac);
    expect(rest.some((el) => el.sizeFrac < headline.sizeFrac)).toBe(true);
  });

  it('skips a line the author left empty rather than reserving its space', () => {
    const { elements } = ctaLayout(cta({ body: '' }), PORTRAIT);
    expect(elements.map((e) => e.text)).toEqual([DEFAULT_CTA.headline, DEFAULT_CTA.url]);
  });

  it('keeps every line inside the frame’s width budget', () => {
    for (const aspect of [REEL, SQUARE, PORTRAIT, 16 / 9]) {
      const { elements } = ctaLayout(cta(), aspect);
      const w = aspect >= 1 ? 1000 : 1000 * aspect;
      const h = aspect >= 1 ? 1000 / aspect : 1000;
      for (const el of elements) {
        // The same pessimistic 0.55 em per character the wrapper budgets on.
        const widthPx = el.text!.length * el.sizeFrac * Math.min(w, h) * 0.55;
        expect(widthPx).toBeLessThanOrEqual(w * 0.86);
      }
    }
  });

  it('centres the block whatever it holds, so a short card does not sit high', () => {
    const full = ctaLayout(cta(), PORTRAIT);
    const bare = ctaLayout(cta({ body: '', url: '', showQr: false }), PORTRAIT);
    // One line alone lands near the middle.
    expect(bare.elements[0].y).toBeGreaterThan(0.4);
    expect(bare.elements[0].y).toBeLessThan(0.6);
    expect(full.elements[0].y).toBeLessThan(bare.elements[0].y);
  });

  it('pins its own ink and flatness against the trip’s title style', () => {
    // The badges may wear a fluorescent CRT look; the closing card must stay
    // a card, or the call to action stops being readable.
    for (const el of ctaLayout(cta(), PORTRAIT).elements) {
      expect(el.styleOverrides).toEqual(
        expect.arrayContaining(['color', 'legibility', 'glow']),
      );
      expect(el.glowAmount).toBe(0);
    }
  });
});

describe('ctaLayout — the QR', () => {
  it('encodes the url', () => {
    const { qr, qrProblem } = ctaLayout(cta(), PORTRAIT);
    expect(qr).not.toBeNull();
    expect(qrProblem).toBeNull();
    expect(qr!.matrix.size).toBe(qr!.matrix.version * 4 + 17);
  });

  it('is absent when switched off, and the text stays', () => {
    const { qr, elements } = ctaLayout(cta({ showQr: false }), PORTRAIT);
    expect(qr).toBeNull();
    expect(elements.map((e) => e.text)).toContain(DEFAULT_CTA.url);
  });

  it('is absent when there is no url to encode', () => {
    expect(ctaLayout(cta({ url: '' }), PORTRAIT).qr).toBeNull();
  });

  it('says WHY it could not draw one, rather than leaving a blank square', () => {
    const long = ctaLayout(cta({ url: `https://x.test/${'y'.repeat(250)}` }), PORTRAIT);
    expect(long.qr).toBeNull();
    expect(long.qrProblem).toMatch(/too long/i);
  });

  it('centres the square horizontally on any frame', () => {
    for (const aspect of [REEL, SQUARE, PORTRAIT, 16 / 9]) {
      const { qr } = ctaLayout(cta(), aspect);
      const widthFrac = qr!.sizeFrac * Math.min(1 / aspect, 1);
      expect(qr!.x + widthFrac / 2).toBeCloseTo(0.5, 6);
    }
  });

  it('keeps the whole block inside the frame', () => {
    for (const aspect of [REEL, SQUARE, PORTRAIT, 16 / 9]) {
      const { elements, qr } = ctaLayout(cta(), aspect);
      expect(qr!.y).toBeGreaterThan(0);
      expect(qr!.y + qr!.sizeFrac * Math.min(aspect, 1)).toBeLessThan(1);
      for (const el of elements) {
        expect(el.y).toBeGreaterThan(0);
        expect(el.y).toBeLessThan(1);
      }
    }
  });

  it('sits between the headline and the body', () => {
    const { elements, qr } = ctaLayout(cta(), PORTRAIT);
    const headline = elements[0];
    const body = elements.find((e) => e.sizeFrac < headline.sizeFrac)!;
    expect(qr!.y).toBeGreaterThan(headline.y);
    expect(qr!.y).toBeLessThan(body.y);
  });
});
