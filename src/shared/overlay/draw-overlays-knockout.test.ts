import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drawOverlays } from './draw-overlays';
import { defaultKnockout, washFill } from './knockout';
import { createTextElement, type OverlayElement } from './overlay-types';

type Op = { op: string; composite: string; fillStyle: unknown; shadowBlur: unknown; args: unknown[] };

/**
 * A 2D context that draws nothing and logs every call with the composite
 * operation, fill and shadow in force at that moment, `save()`/`restore()`
 * honoured — enough to tell what a masked text asked of the canvas.
 */
function recordingContext(canvas: unknown = { width: 400, height: 500 }) {
  const ops: Op[] = [];
  const fresh = () => ({
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '#000000',
    shadowBlur: 0,
  });
  let state: Record<string, unknown> = fresh();
  const stack: Record<string, unknown>[] = [];
  const log = (op: string, args: unknown[]) =>
    ops.push({
      op,
      composite: state.globalCompositeOperation as string,
      fillStyle: state.fillStyle,
      shadowBlur: state.shadowBlur,
      args,
    });
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, key: string) {
      if (key === 'canvas') return canvas;
      if (key in state) return state[key];
      if (key === 'save') return () => stack.push({ ...state });
      if (key === 'restore') return () => {
        state = stack.pop() ?? fresh();
      };
      if (key === 'measureText') {
        return (text: string) => ({
          width: text.length * 10,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: text.length * 10,
        });
      }
      return (...args: unknown[]) => log(key, args);
    },
    set(_target, key: string, value) {
      state[key] = value;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, ops };
}

/** The buffers `drawOverlays` builds, each with the log of what was drawn into it. */
const buffers: { canvas: { width: number; height: number }; ops: Op[] }[] = [];

class RecordingOffscreenCanvas {
  width: number;
  height: number;
  private rec: ReturnType<typeof recordingContext>;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.rec = recordingContext(this);
    buffers.push({ canvas: this, ops: this.rec.ops });
  }
  getContext() {
    return this.rec.ctx;
  }
}

beforeAll(() => vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas));
afterAll(() => vi.unstubAllGlobals());

const line = (text: string, over: Partial<OverlayElement> = {}): OverlayElement => ({
  ...createTextElement(text),
  ...over,
});

const texts = (ops: Op[]) => ops.filter((o) => o.op === 'fillText');

describe('drawOverlays — a punch', () => {
  it('paints the bare letters in the ground’s colour, never blended', () => {
    const { ctx, ops } = recordingContext();
    const knockout = { ...defaultKnockout('punch'), color: '#fafafa' };
    drawOverlays(ctx, [line('Cut', { knockout, blend: 'multiply' })], null, 400, 500);
    const [cut] = texts(ops);
    expect(cut.args[0]).toBe('Cut');
    expect(cut.fillStyle).toBe('#fafafa');
    expect(cut.shadowBlur).toBe(0);
    expect(cut.composite).toBe('source-over');
  });
});

describe('drawOverlays — a wash', () => {
  it('cuts the letters out of a wash in a buffer, then lays the buffer over the frame', () => {
    const { ctx, ops } = recordingContext();
    const knockout = { ...defaultKnockout('wash'), alpha: 0.5 };
    drawOverlays(ctx, [line('Shark Bay', { knockout })], null, 400, 500);

    // Nothing is written as text on the frame itself…
    expect(texts(ops)).toHaveLength(0);
    // …the buffer is: a wash first, then the glyphs, erasing it.
    const buf = buffers.at(-1)!;
    const fill = buf.ops.find((o) => o.op === 'fillRect');
    expect(fill?.fillStyle).toBe(washFill(knockout));
    const [glyphs] = texts(buf.ops);
    expect(glyphs.args[0]).toBe('Shark Bay');
    expect(glyphs.composite).toBe('destination-out');
    expect(glyphs.shadowBlur).toBe(0);
    expect(buf.ops.indexOf(fill!)).toBeLessThan(buf.ops.indexOf(glyphs));
    // …and the cut wash covers the whole frame.
    const laid = ops.find((o) => o.op === 'drawImage');
    expect(laid?.args[0]).toBe(buf.canvas);
    expect(laid?.args.slice(5)).toEqual([0, 0, 400, 500]);
  });

  it('draws the element after it, and the next frame, on a clean slate', () => {
    const { ctx, ops } = recordingContext();
    drawOverlays(
      ctx,
      [line('Masked', { knockout: defaultKnockout('wash') }), line('After')],
      null,
      400,
      500,
    );
    const after = texts(ops).find((o) => o.args[0] === 'After');
    expect(after?.composite).toBe('source-over');
    // The buffer was cleared before this wash, not painted over the last one.
    const buf = buffers.at(-1)!;
    const lastClear = buf.ops.map((o) => o.op).lastIndexOf('clearRect');
    const lastFill = buf.ops.map((o) => o.op).lastIndexOf('fillRect');
    expect(lastClear).toBeGreaterThanOrEqual(0);
    expect(lastClear).toBeLessThan(lastFill);
  });

  it('cuts a frame bigger than a buffer at a reduced scale, and lays it back full size', () => {
    const { ctx, ops } = recordingContext({ width: 8000, height: 6000 });
    drawOverlays(ctx, [line('Big', { knockout: defaultKnockout('wash') })], null, 8000, 6000);
    const laid = ops.find((o) => o.op === 'drawImage');
    expect(laid).toBeDefined();
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = laid!.args as number[];
    expect([sx, sy, dx, dy]).toEqual([0, 0, 0, 0]);
    expect(sw).toBeLessThanOrEqual(4096);
    expect(sw / sh).toBeCloseTo(8000 / 6000, 2);
    expect([dw, dh]).toEqual([8000, 6000]);
  });

  it('ignores a mask on an instrument — it has no letters to cut with', () => {
    const { ctx, ops } = recordingContext();
    const corners: OverlayElement = {
      ...createTextElement(''),
      kind: 'frame-corners',
      knockout: defaultKnockout('wash'),
    };
    drawOverlays(ctx, [corners], null, 400, 500);
    expect(ops.some((o) => o.op === 'drawImage')).toBe(false);
  });
});
