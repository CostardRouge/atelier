import { describe, expect, it } from 'vitest';
import { paintOverlay, type Block, type OverlayLayout } from './atlas-overlay';
import { themeWith } from './atlas-settings';

/** A 2D context that draws nothing and measures every character 10 px wide. */
function silentContext(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy({} as Record<string, unknown>, {
    get(_t, key: string) {
      if (key in state) return state[key];
      if (key === 'canvas') return { width: 1920, height: 1080 };
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      return () => undefined;
    },
    set(_t, key: string, value) {
      state[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const area = { x: 0, y: 0, w: 1920, h: 1080 };
const layout = (spots: OverlayLayout['spots']): OverlayLayout => ({
  spots,
  theme: themeWith('neutral', { legibility: { mode: 'none', color: 'rgba(0,0,0,0)', padFrac: 0 } }),
  accent: '#ff5533',
  scale: 1,
});

/** The intro's middle stack at one instant: the title in, the line fading in from `line`. */
function titleTop(line: number): number {
  const blocks: Block[] = [
    { kind: 'text', text: 'Perth', size: 96, gapAfter: 0.12, alpha: 1, owner: 'intro' },
    { kind: 'text', text: '40 flights', size: 30, gapAfter: 0.7, alpha: line, owner: 'intro' },
  ];
  const hits = paintOverlay(silentContext(), layout({ mc: blocks }), area);
  return hits[0].y;
}

describe('paintOverlay', () => {
  it('keeps a faded-out block in its stack, so a line fading in never moves the lines above it', () => {
    expect(titleTop(0)).toBeCloseTo(titleTop(0.5), 6);
    expect(titleTop(0)).toBeCloseTo(titleTop(1), 6);
  });

  it('sizes a counting cell for the total it counts to, so the row keeps its width', () => {
    const row = (value: string): number => {
      const blocks: Block[] = [{ kind: 'row', size: 56, owner: 'outro', items: [{ value, label: 'km', room: '1234 km' }, { value: '3', label: 'flights' }] }];
      return paintOverlay(silentContext(), layout({ mc: blocks }), area)[0].w;
    };
    expect(row('0.0 km')).toBeCloseTo(row('1234 km'), 6);
  });
});
