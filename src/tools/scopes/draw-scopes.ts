/**
 * Canvas drawing for the scopes. Pure compute lives in `scopes.ts`; this turns
 * that data into pixels on a 2D context. Not unit-tested (it's all canvas), so
 * it stays thin and declarative.
 */

import type { Histograms, Vectorscope, Waveform } from './scopes';

const BG = '#14120f';
const GRID = 'rgba(255,255,255,0.10)';
const R_COL: [number, number, number] = [255, 86, 86];
const G_COL: [number, number, number] = [78, 214, 122];
const B_COL: [number, number, number] = [96, 154, 255];
const LUMA_COL: [number, number, number] = [222, 216, 202];

export type HistogramMode = 'rgb' | 'luma';
export type WaveformMode = 'luma' | 'parade';

// Reusable offscreen canvases, sized on demand — avoids per-frame allocation.
const scratch = new Map<string, HTMLCanvasElement>();
function scratchCtx(key: string, w: number, h: number): CanvasRenderingContext2D {
  let canvas = scratch.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    scratch.set(key, canvas);
  }
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return ctx;
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
}

export function drawHistogram(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hists: Histograms,
  mode: HistogramMode,
) {
  clear(ctx, w, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = Math.round((w * i) / 4) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  const max = hists.max || 1;
  const channel = (
    arr: Uint32Array,
    col: [number, number, number],
    blend: GlobalCompositeOperation,
  ) => {
    ctx.globalCompositeOperation = blend;
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.8)`;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let v = 0; v < 256; v++) {
      const x = (v / 255) * w;
      const y = h - Math.min(1, arr[v] / max) * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };

  if (mode === 'luma') {
    channel(hists.luma, LUMA_COL, 'source-over');
  } else {
    channel(hists.r, R_COL, 'lighter');
    channel(hists.g, G_COL, 'lighter');
    channel(hists.b, B_COL, 'lighter');
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Paint a `width × 256` column-density grid into a scratch canvas. */
function paintColumns(
  arr: Uint32Array,
  width: number,
  col: [number, number, number],
): HTMLCanvasElement {
  const c = scratchCtx('wf', width, 256);
  const img = c.createImageData(width, 256);
  const d = img.data;
  let max = 1;
  for (let k = 0; k < arr.length; k++) if (arr[k] > max) max = arr[k];
  for (let x = 0; x < width; x++) {
    const base = x * 256;
    for (let level = 0; level < 256; level++) {
      const count = arr[base + level];
      if (!count) continue;
      const inten = Math.sqrt(count / max);
      const p = ((255 - level) * width + x) * 4; // flip: bright at top
      d[p] = col[0] * inten;
      d[p + 1] = col[1] * inten;
      d[p + 2] = col[2] * inten;
      d[p + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return c.canvas;
}

export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wf: Waveform,
  mode: WaveformMode,
) {
  clear(ctx, w, h);
  ctx.imageSmoothingEnabled = true;
  if (mode === 'parade') {
    const chans: Array<[Uint32Array, [number, number, number]]> = [
      [wf.r, R_COL],
      [wf.g, G_COL],
      [wf.b, B_COL],
    ];
    const third = w / 3;
    chans.forEach(([arr, col], i) => {
      const cv = paintColumns(arr, wf.width, col);
      ctx.drawImage(cv, 0, 0, wf.width, 256, i * third, 0, third, h);
    });
  } else {
    const cv = paintColumns(wf.luma, wf.width, LUMA_COL);
    ctx.drawImage(cv, 0, 0, wf.width, 256, 0, 0, w, h);
  }
}

export function drawVectorscope(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  vs: Vectorscope,
) {
  clear(ctx, w, h);
  const side = Math.min(w, h);
  const ox = (w - side) / 2;
  const oy = (h - side) / 2;
  const cx = ox + side / 2;
  const cy = oy + side / 2;

  // The trace.
  const c = scratchCtx('vs', vs.size, vs.size);
  const img = c.createImageData(vs.size, vs.size);
  const d = img.data;
  const max = vs.max || 1;
  for (let i = 0; i < vs.data.length; i++) {
    const count = vs.data[i];
    if (!count) continue;
    const inten = Math.sqrt(count / max);
    const p = i * 4;
    d[p] = 70 + 150 * inten;
    d[p + 1] = 200 * inten + 40;
    d[p + 2] = 110 * inten;
    d[p + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c.canvas, 0, 0, vs.size, vs.size, ox, oy, side, side);

  // Graticule: outer ring, cross-hair, and the skin-tone (I) line.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, (side / 2) * 0.98, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, oy);
  ctx.lineTo(cx, oy + side);
  ctx.moveTo(ox, cy);
  ctx.lineTo(ox + side, cy);
  ctx.stroke();

  // Skin-tone line — 33° left of vertical (up-left), where flesh tones sit.
  const r = (side / 2) * 0.98;
  const a = (33 * Math.PI) / 180;
  ctx.strokeStyle = 'rgba(255,180,120,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - r * Math.sin(a), cy - r * Math.cos(a));
  ctx.stroke();
}
