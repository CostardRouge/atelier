import { describe, expect, it } from 'vitest';
import { createRecapDoc, withCaption, withPictures, withRecap } from './recap-doc';
import { hasStyle, styleOf, withStyle } from './recap-style';

describe('a template kept as one’s style', () => {
  it('carries the look to the next recap, never its content', () => {
    let a = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    a = withPictures(a, [{ key: 'l:a', origin: 'local', name: 'a.jpg', kind: 'photo', day: '2026-10-02' }]);
    a = withCaption(a, '2026-10-02', 'sea');
    a = withRecap(a, {
      format: 'portrait',
      cells: { ...a.cells, shadow: 0.5, exif: true },
      background: { ...a.background, kind: 'video', video: 'l:clip', veil: 0.4, loopIn: 2, frame: { x: 0.2, y: 0.5, zoom: 2 } },
      motion: { ...a.motion, order: 'spiral' },
      delivery: { ...a.delivery, fps: 60 },
    });
    const style = JSON.parse(JSON.stringify(styleOf(a)));
    const b = withStyle(createRecapDoc('month', 'local', { anchor: '2026-11-01', now: 2 }), style, 3);
    expect(b.format).toBe('portrait');
    expect(b.cells.shadow).toBe(0.5);
    expect(b.motion.order).toBe('spiral');
    expect(b.delivery.fps).toBe(60);
    expect(b.background.kind).toBe('video');
    expect(b.background.veil).toBe(0.4);
    // Not its content: no clip, no loop, no framing, no pictures, no captions, its own days and seed.
    expect(b.background.video ?? null).toBeNull();
    expect(b.background.loopIn).toBe(0);
    expect(b.background.frame).toBeUndefined();
    expect(b.pictures).toEqual([]);
    expect(b.captions).toEqual({});
    expect(b.anchor).toBe('2026-11-01');
    expect(hasStyle(b, style)).toBe(true);
    expect(hasStyle(withRecap(b, { format: 'square' }), style)).toBe(false);
  });

  it('ignores a style of another template, or none', () => {
    const week = createRecapDoc('week', 'local', { anchor: '2026-11-02', now: 1 });
    const style = styleOf(withRecap(createRecapDoc('month', 'local', { now: 1 }), { format: 'square' }));
    expect(withStyle(week, style)).toBe(week);
    expect(withStyle(week, null)).toBe(week);
  });
});
