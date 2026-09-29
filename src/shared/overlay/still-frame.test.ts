import { describe, expect, it } from 'vitest';
import { elementSettleSeconds, settleForStill } from './still-frame';
import { createTextElement } from './overlay-types';
import type { OverlayElement } from './overlay-types';

function timed(): OverlayElement {
  return {
    ...createTextElement('Hook'),
    window: { start: 0, end: 2.5 },
    animation: {
      in: { preset: 'slide', duration: 0.6, easing: 'out' },
      out: { preset: 'fade', duration: 0.4, easing: 'in' },
    },
    sceneId: 'intro',
  };
}

describe('settleForStill', () => {
  it('drops the clock an element depends on', () => {
    const [el] = settleForStill([timed()]);
    expect(el.window).toBeUndefined();
    expect(el.animation).toBeUndefined();
    expect(el.sceneId).toBeUndefined();
  });

  it('keeps everything else about the element', () => {
    const source = timed();
    const [el] = settleForStill([source]);
    expect(el.id).toBe(source.id);
    expect(el.text).toBe('Hook');
    expect(el.x).toBe(source.x);
    expect(el.y).toBe(source.y);
    expect(el.sizeFrac).toBe(source.sizeFrac);
  });

  it('returns the very same array when nothing is timed', () => {
    const deck = [createTextElement('A'), createTextElement('B')];
    expect(settleForStill(deck)).toBe(deck);
  });

  it('leaves untimed neighbours identical while settling the timed one', () => {
    const plain = createTextElement('Plain');
    const out = settleForStill([plain, timed()]);
    expect(out[0]).toBe(plain);
    expect(out[1].window).toBeUndefined();
  });
});

describe('elementSettleSeconds', () => {
  const text = (over: Partial<OverlayElement> = {}): OverlayElement => ({ ...createTextElement('Noon'), ...over });

  it('is zero for an element with no clock', () => {
    expect(elementSettleSeconds(text())).toBe(0);
  });

  it('waits for the window to open and the entrance to play, its delay included', () => {
    expect(
      elementSettleSeconds(
        text({
          window: { start: 1, end: null },
          animation: { in: { preset: 'fade', duration: 0.5, easing: 'linear', delay: 0.25 } },
        }),
      ),
    ).toBeCloseTo(1.75);
  });

  it('never counts the exit — a still wants the element settled, not gone', () => {
    expect(
      elementSettleSeconds(
        text({ animation: { out: { preset: 'fade', duration: 3, easing: 'linear' } } }),
      ),
    ).toBe(0);
  });
});
