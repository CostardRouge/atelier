/**
 * Draws the editor-only composition guides (grid + social safe zones) onto the
 * overlay stage canvas.
 *
 * Kept OUT of `draw-overlays.ts` on purpose: the export pipeline calls
 * `drawOverlays` directly, so anything here lives in the editor preview and
 * never burns into the rendered MP4.
 */

import {
  resolveSafeZone,
  targetFrame,
  type GuidesState,
  type SafeZonePreset,
} from './guides';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawGrid(
  ctx: Ctx2D,
  cols: number,
  rows: number,
  vw: number,
  vh: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, vh * 0.0015);
  ctx.beginPath();
  for (let i = 1; i < cols; i++) {
    const x = Math.round((i / cols) * vw) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, vh);
  }
  for (let j = 1; j < rows; j++) {
    const y = Math.round((j / rows) * vh) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(vw, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSafeZone(
  ctx: Ctx2D,
  preset: SafeZonePreset,
  vw: number,
  vh: number,
): void {
  const f = targetFrame(preset.aspect, vw, vh);
  ctx.save();

  // Dim the area outside the target crop (what the platform won't show).
  if (f.w < vw - 1 || f.h < vh - 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (f.y > 0) {
      ctx.fillRect(0, 0, vw, f.y);
      ctx.fillRect(0, f.y + f.h, vw, vh - f.y - f.h);
    }
    if (f.x > 0) {
      ctx.fillRect(0, 0, f.x, vh);
      ctx.fillRect(f.x + f.w, 0, vw - f.x - f.w, vh);
    }
  }

  // Outline the target frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1.5, vh * 0.002);
  ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);

  // The deadzones the platform UI covers — translucent so content shows through.
  const fontPx = Math.max(11, vh * 0.02);
  for (const r of preset.deadzones) {
    const x = f.x + r.x * f.w;
    const y = f.y + r.y * f.h;
    const w = r.w * f.w;
    const h = r.h * f.h;
    ctx.fillStyle = 'rgba(217,68,42,0.28)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(217,68,42,0.6)';
    ctx.lineWidth = Math.max(1, vh * 0.0012);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (r.label) {
      ctx.font = `600 ${fontPx}px ui-monospace, monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(r.label, x + fontPx * 0.35, y + fontPx * 0.3);
    }
  }
  ctx.restore();
}

/** Paint the active guides over the stage. Order: grid under, safe zone over. */
export function drawGuides(
  ctx: Ctx2D,
  guides: GuidesState,
  vw: number,
  vh: number,
): void {
  if (guides.grid.show) drawGrid(ctx, guides.grid.cols, guides.grid.rows, vw, vh);
  // The template may be turned a quarter-turn to span the frame — see
  // `resolveSafeZone`. Everything below is orientation-agnostic from here.
  const preset = resolveSafeZone(guides, vh > 0 ? vw / vh : 0);
  if (preset) drawSafeZone(ctx, preset, vw, vh);
}
