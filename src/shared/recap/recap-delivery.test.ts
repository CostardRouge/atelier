import { describe, expect, it } from 'vitest';
import { deliveryBitrate, deliverySize, needsOriginal, readDelivery, sizeText } from './recap-delivery';

describe('how a recap’s video is delivered', () => {
  it('scales its target with the size and the frame rate', () => {
    expect(deliveryBitrate({ quality: 'high', fps: 30 }, 1080, 1920)).toBe(16e6);
    expect(deliveryBitrate({ quality: 'high', fps: 30 }, 1080, 1080)).toBe(9e6);
    expect(deliveryBitrate({ quality: 'standard', fps: 60 }, 1080, 1920)).toBeCloseTo(8e6 * 2 ** 0.75, -3);
    expect(sizeText(deliverySize({ quality: 'high', fps: 30 }, 1080, 1920, 15, false))).toBe('30 MB');
  });

  it('reads what it stored, and its first name for the media', () => {
    expect(readDelivery({ quality: 'max', fps: 60, passes: 2, media: 'original' })).toEqual({ quality: 'max', fps: 60, passes: 2, media: 'original' });
    expect(readDelivery({ clips: 'original' }).media).toBe('original');
    expect(readDelivery('nope')).toEqual({ quality: 'high', fps: 30, passes: 1, media: 'proxy' });
  });

  it('fetches an original only where its print would be blown up', () => {
    // A landscape 2048 print filling a 9:16 page: its 1365 rows stretched to 1920.
    expect(needsOriginal(2048, 1365, { x: 0, y: 0, w: 1080, h: 1920 })).toBe(true);
    // A month's cell, 140 px: never.
    expect(needsOriginal(2048, 1365, { x: 0, y: 0, w: 140, h: 140 })).toBe(false);
    // The same cell zoomed ×4 on a small print: yes.
    expect(needsOriginal(400, 300, { x: 0, y: 0, w: 140, h: 140 }, { x: 0.5, y: 0.5, zoom: 4 })).toBe(true);
  });
});
