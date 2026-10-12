import { describe, expect, it } from 'vitest';
import { SENT_MAX, clearSent, isImageResult, recordSent, sentImages, subscribeSent } from './sent-images';
import type { ImageResult } from './registry';

const image = (n: number): ImageResult => ({ kind: 'image', mimeType: 'image/png', data: btoa(`png${n}`), width: 10 + n, height: 5, note: `sheet ${n}` });

describe('the pictures sent to an agent', () => {
  it('tells a picture answer from any other', () => {
    expect(isImageResult(image(1))).toBe(true);
    expect(isImageResult({ kind: 'image' })).toBe(false);
    expect(isImageResult({ rows: [] })).toBe(false);
    expect(isImageResult(null)).toBe(false);
  });

  it('keeps them newest first, bounded, as blobs, and tells who listens', async () => {
    clearSent();
    let heard = 0;
    const off = subscribeSent(() => heard++);
    for (let i = 0; i < SENT_MAX + 3; i++) recordSent('winnow.sheet', { date: '2026-01-14', i }, image(i), 1000 + i);
    const kept = sentImages();
    expect(kept).toHaveLength(SENT_MAX);
    expect(kept[0]).toMatchObject({ command: 'winnow.sheet', params: { i: SENT_MAX + 2 }, width: 10 + SENT_MAX + 2, note: `sheet ${SENT_MAX + 2}`, at: 1000 + SENT_MAX + 2 });
    expect(kept[0].seq).toBeGreaterThan(kept[1].seq);
    expect(await kept[0].blob.text()).toBe(`png${SENT_MAX + 2}`);
    expect(kept[0].blob.type).toBe('image/png');
    expect(heard).toBe(SENT_MAX + 3);
    clearSent();
    expect(sentImages()).toHaveLength(0);
    clearSent();
    expect(heard).toBe(SENT_MAX + 4);
    off();
  });

  it('drops an answer whose bytes are not base64 rather than throwing', () => {
    clearSent();
    recordSent('develop.snapshot', {}, { ...image(1), data: '%%%' });
    expect(sentImages()).toHaveLength(0);
  });
});
