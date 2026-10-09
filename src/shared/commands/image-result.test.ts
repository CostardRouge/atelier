import { describe, expect, it } from 'vitest';
import { bytesToBase64, imageResult, untilSteady } from './image-result';

describe('bytesToBase64', () => {
  it('encodes like the platform, across chunk boundaries', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    expect(bytesToBase64(bytes)).toBe(btoa(binary));
    expect(bytesToBase64(new Uint8Array())).toBe('');
  });
});

describe('imageResult', () => {
  it('carries the bytes, the type, the size and the note', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(await imageResult(blob, 4, 3, 'as delivered')).toEqual({
      kind: 'image',
      mimeType: 'image/png',
      data: 'AQID',
      width: 4,
      height: 3,
      note: 'as delivered',
    });
  });

  it('calls anything that is not a PNG a JPEG, and leaves an absent note out', async () => {
    const r = await imageResult(new Blob([new Uint8Array([0])]), 1, 1);
    expect(r.mimeType).toBe('image/jpeg');
    expect('note' in r).toBe(false);
  });
});

describe('untilSteady', () => {
  it('waits until the value stops changing for the quiet span', async () => {
    let v = 0;
    const changes = setInterval(() => v++, 10);
    setTimeout(() => clearInterval(changes), 80);
    const t0 = Date.now();
    await untilSteady(() => v, 60, 2000, 5);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(120);
    const seen = v;
    await new Promise((r) => setTimeout(r, 30));
    expect(v).toBe(seen);
  });

  it('gives up at the cap on a value that never settles', async () => {
    let v = 0;
    const changes = setInterval(() => v++, 5);
    const t0 = Date.now();
    await untilSteady(() => v, 1000, 60, 5);
    clearInterval(changes);
    expect(Date.now() - t0).toBeLessThan(400);
  });
});
