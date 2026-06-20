/**
 * Canvas drawing of the telemetry readout card — shared by the live preview and
 * the export so they match pixel-for-pixel. The line/colour model is pure
 * (`overlay.ts`); this only paints.
 */

import type { Cue } from '../telemetry/srt-parser';
import { buildLines, FONT_STACK, hexToRgba, type OverlayConfig } from './overlay';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draw the readout for `cue` at normalised `pos` within a `pw`×`ph` frame, per
 * the overlay config. Returns the drawn box (frame px) for hit-testing, or null
 * when hidden / empty. The font size scales with the frame height, so the same
 * normalised position and scale look identical at preview and export sizes.
 */
export function drawReadout(
  ctx: Ctx,
  cue: Cue | null,
  pos: { x: number; y: number },
  pw: number,
  ph: number,
  cfg: OverlayConfig,
): Box | null {
  if (!cfg.show) return null;
  const lines = buildLines(cue, cfg);
  if (lines.length === 0) return null;

  const base = Math.max(10, Math.round(ph * 0.03));
  const fs = Math.max(8, Math.round(base * cfg.fontScale));
  const pad = Math.round(fs * 0.7);
  ctx.font = `600 ${fs}px ${FONT_STACK[cfg.font]}`;
  ctx.textBaseline = 'alphabetic';
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const lh = fs * 1.35;
  const boxW = maxW + pad * 2;
  const boxH = lines.length * lh + pad * 2 - (lh - fs);
  const x = Math.min(Math.max(0, pos.x * pw), Math.max(0, pw - boxW));
  const y = Math.min(Math.max(0, pos.y * ph), Math.max(0, ph - boxH));

  ctx.fillStyle = hexToRgba(cfg.bgColor, cfg.bgOpacity);
  roundRect(ctx, x, y, boxW, boxH, Math.min(cfg.radius, boxH / 2, boxW / 2));
  ctx.fill();

  ctx.fillStyle = cfg.textColor;
  let ty = y + pad + fs * 0.85;
  for (const l of lines) {
    ctx.fillText(l, x + pad, ty);
    ty += lh;
  }
  return { x, y, w: boxW, h: boxH };
}
