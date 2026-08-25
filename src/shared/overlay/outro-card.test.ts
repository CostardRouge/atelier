import { describe, expect, it } from 'vitest';
import {
  OUTRO_SECONDS_DEFAULT,
  createOutroCard,
  prepareOutro,
  withOutroLine,
  type OutroCard,
} from './outro-card';

const card = (over: Partial<OutroCard> = {}): OutroCard => ({
  ...createOutroCard('Merci'),
  ...over,
});

describe('createOutroCard', () => {
  it('seeds one editable headline on a flat ground', () => {
    const c = createOutroCard('Vol du soir');
    expect(c.seconds).toBe(OUTRO_SECONDS_DEFAULT);
    expect(c.elements).toHaveLength(1);
    expect(c.elements[0].text).toBe('Vol du soir');
    expect(c.qr).toBeNull();
  });

  it('pins its lines against any theme — the card ink is its own', () => {
    const [el] = createOutroCard('x').elements;
    expect(el.styleOverrides).toContain('color');
    expect(el.styleOverrides).toContain('legibility');
    expect(el.styleOverrides).toContain('glow');
  });
});

describe('withOutroLine', () => {
  it('stacks the new line under the lowest text', () => {
    const c = withOutroLine(card(), 'sub');
    expect(c.elements).toHaveLength(2);
    expect(c.elements[1].y).toBeGreaterThan(c.elements[0].y);
  });

  it('never pushes a line off the frame', () => {
    let c = card();
    for (let i = 0; i < 20; i += 1) c = withOutroLine(c);
    for (const el of c.elements) expect(el.y).toBeLessThanOrEqual(0.92);
  });

  it('leaves the original card untouched', () => {
    const before = card();
    withOutroLine(before);
    expect(before.elements).toHaveLength(1);
  });
});

describe('prepareOutro', () => {
  const qr = (url: string) => ({
    url,
    x: 0.35,
    y: 0.55,
    sizeFrac: 0.3,
    dark: '#fff',
    light: '#111',
  });

  it('encodes a real link into a drawable matrix', () => {
    const p = prepareOutro(card({ qr: qr('https://example.com/x') }));
    expect(p.qr).not.toBeNull();
    expect(p.qrProblem).toBeNull();
    expect(p.qr!.matrix.size).toBeGreaterThan(0);
  });

  it('no URL means no QR and no complaint', () => {
    expect(prepareOutro(card()).qr).toBeNull();
    expect(prepareOutro(card()).qrProblem).toBeNull();
    const blank = prepareOutro(card({ qr: qr('   ') }));
    expect(blank.qr).toBeNull();
    expect(blank.qrProblem).toBeNull();
  });

  it('refuses a link too long to encode, with a sentence', () => {
    const p = prepareOutro(card({ qr: qr(`https://x.dev/${'a'.repeat(300)}`) }));
    expect(p.qr).toBeNull();
    expect(p.qrProblem).toMatch(/too long/);
  });

  it('keeps the card’s placement and inks on the encoded code', () => {
    const p = prepareOutro(card({ qr: qr('https://example.com') }));
    expect(p.qr).toMatchObject({ x: 0.35, y: 0.55, sizeFrac: 0.3, dark: '#fff', light: '#111' });
  });
});
