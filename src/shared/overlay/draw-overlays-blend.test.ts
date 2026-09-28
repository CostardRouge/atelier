import { describe, expect, it } from 'vitest';
import { drawOverlays } from './draw-overlays';
import { createTextElement, type OverlayElement } from './overlay-types';

/**
 * A 2D context that draws nothing and remembers, for every text it was asked
 * to fill, the composite operation in force at that moment — with `save()` and
 * `restore()` honoured, since that is what keeps a blend on its own element.
 */
function recordingContext() {
  const fills: { text: string; composite: string }[] = [];
  const stack: string[] = [];
  const state: Record<string, unknown> = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, key: string) {
      if (key in state) return state[key];
      if (key === 'save') return () => stack.push(state.globalCompositeOperation as string);
      if (key === 'restore') return () => {
        state.globalCompositeOperation = stack.pop() ?? 'source-over';
      };
      if (key === 'fillText') {
        return (text: string) => fills.push({ text, composite: state.globalCompositeOperation as string });
      }
      if (key === 'measureText') {
        return (text: string) => ({
          width: text.length * 10,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: text.length * 10,
        });
      }
      if (key === 'canvas') return { width: 400, height: 500 };
      return () => undefined;
    },
    set(_target, key: string, value) {
      state[key] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, fills };
}

const line = (text: string, over: Partial<OverlayElement> = {}): OverlayElement => ({
  ...createTextElement(text),
  legibility: { mode: 'none', color: 'rgba(0,0,0,0)', padFrac: 0 },
  ...over,
});

describe('drawOverlays — blend', () => {
  it('draws an element under its own blend, and the next one plainly again', () => {
    const { ctx, fills } = recordingContext();
    drawOverlays(ctx, [line('Stain', { blend: 'multiply' }), line('Plain')], null, 400, 500);
    const stain = fills.find((f) => f.text === 'Stain');
    const plain = fills.find((f) => f.text === 'Plain');
    expect(stain?.composite).toBe('multiply');
    expect(plain?.composite).toBe('source-over');
  });

  it('draws an element with no blend, or an unknown one, exactly as before', () => {
    const { ctx, fills } = recordingContext();
    drawOverlays(
      ctx,
      [line('Old'), line('Future', { blend: 'hue-shift' as never }), line('Normal', { blend: 'normal' })],
      null,
      400,
      500,
    );
    expect(fills.map((f) => f.composite)).toEqual(fills.map(() => 'source-over'));
    expect(fills.map((f) => f.text)).toEqual(expect.arrayContaining(['Old', 'Future', 'Normal']));
  });
});
