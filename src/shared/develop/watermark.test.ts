import { describe, expect, it } from 'vitest';
import { DEFAULT_WATERMARK, readWatermark, resolveWatermarkText, sameWatermark, watermarkLayout } from './watermark';

describe('the watermark line', () => {
  it('fills the identity and the capture into the template', () => {
    expect(resolveWatermarkText('© {year} {creator}', { creator: 'Steeve Pommier', year: 2025 })).toBe('© 2025 Steeve Pommier');
    expect(resolveWatermarkText('{title} — {creator}', { creator: 'S', title: '  Uluru  ' })).toBe('Uluru — S');
  });

  it('drops a token with nothing behind it, and draws nothing that says nothing', () => {
    expect(resolveWatermarkText('© {year} {creator}', { creator: 'S' })).toBe('© S');
    // A line that names its author and has none signs nothing: not drawn.
    expect(resolveWatermarkText('© {year} {creator}', { year: 2025 })).toBe('');
    expect(resolveWatermarkText('{title}', { title: '' })).toBe('');
    expect(resolveWatermarkText('steeve.website', {})).toBe('steeve.website');
    expect(resolveWatermarkText('   ', { creator: 'S' })).toBe('');
  });
});

describe('where it sits', () => {
  it('is a share of the SHORT side tall, so a web copy and the full picture carry the same mark', () => {
    const big = watermarkLayout(6000, 4000, { position: 'bottom-right', size: 2.5 });
    const small = watermarkLayout(1620, 1080, { position: 'bottom-right', size: 2.5 });
    expect(big.fontPx / 4000).toBeCloseTo(small.fontPx / 1080, 2);
    expect(big).toMatchObject({ x: 6000 - 100, y: 4000 - 100, align: 'right', baseline: 'bottom' });
  });

  it('anchors each position to its own corner or edge', () => {
    expect(watermarkLayout(1000, 800, { position: 'top-left', size: 3 })).toMatchObject({ x: 24, y: 24, align: 'left', baseline: 'top' });
    expect(watermarkLayout(1000, 800, { position: 'bottom', size: 3 })).toMatchObject({ x: 500, align: 'center', baseline: 'bottom' });
  });
});

describe('the record', () => {
  it('reads back safely, clamped, and compares by value', () => {
    expect(readWatermark(null)).toEqual(DEFAULT_WATERMARK);
    const read = readWatermark({ text: 'x'.repeat(300), position: 'middle', size: 40, opacity: 0, tone: 'dark' });
    expect(read).toEqual({ text: 'x'.repeat(120), position: 'bottom-right', size: 8, opacity: 0.1, tone: 'dark' });
    expect(sameWatermark(read, { ...read })).toBe(true);
    expect(sameWatermark(read, { ...read, tone: 'light' })).toBe(false);
  });
});
