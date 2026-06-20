/**
 * Export the live composition to an MP4.
 *
 * Reuses the shared WebCodecs pipeline with `outputSize` set to the composition
 * frame, and a processor that draws — per decoded frame — the (LUT-graded,
 * upright) video, the map, and the telemetry readout, exactly as the preview
 * composites them.
 *
 * The map is the subtle part: the pipeline's `draw` is synchronous, so we can't
 * await a MapLibre render per frame. Instead we build a full-resolution export
 * map once, frame the whole track, wait for it to render, **snapshot** it, then
 * draw the snapshot every frame and place the aircraft marker ourselves via
 * `map.project()` (synchronous) — fast and frame-accurate. The export uses the
 * fixed whole-track framing (not the live "follow" mode).
 */

import type { Map as MlMap } from 'maplibre-gl';
import type { Cue } from '../telemetry/srt-parser';
import { findCue } from '../telemetry/find-cue';
import { parsePosition, type TrackPoint } from '../map/flight-path';
import type { CubeLut } from '../../shared/lib/cube-parser';
import { makeFrameGrader } from '../lut/frame-grader';
import {
  drawRotatedFrame,
  exportProcessedVideo,
  makeExportCanvas,
  type ExportProgress,
  type FrameProcessor,
} from '../../shared/media/webcodecs-export';
import {
  even,
  fitRect,
  paneRects,
  type Corner,
  type Fit,
  type LayoutKind,
} from './compose-layout';
import { drawReadout } from './draw-readout';
import type { OverlayConfig } from './overlay';
import {
  addTrackLine,
  cameraForTrack,
  COMPOSER_STYLE,
  MAP_ACCENT,
  setTiles,
} from './map-shared';

export interface CompositionOptions {
  outW: number;
  outH: number;
  layout: LayoutKind;
  split: number;
  inset: number;
  corner: Corner;
  videoFit: Fit;
  lut: CubeLut | null;
  intensity: number;
  overlay: OverlayConfig;
  readoutPos: { x: number; y: number };
  cues: Cue[];
  track: TrackPoint[];
  tilesOn: boolean;
  zoomOffset: number;
}

interface ExportMap {
  /** A snapshot of the framed map at pane resolution, or null if unavailable. */
  base: HTMLCanvasElement | null;
  /** Project a `[lon, lat]` to pane pixels, or null. */
  project: (pos: [number, number]) => { x: number; y: number } | null;
  dispose: () => void;
}

const NO_MAP: ExportMap = { base: null, project: () => null, dispose: () => {} };

/** Resolve once the map has settled (rendered + tiles), or after `timeoutMs`. */
function awaitIdle(map: MlMap, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once('idle', finish);
    setTimeout(finish, timeoutMs);
  });
}

/** Build the export map, frame the track, and snapshot it at pane resolution. */
async function buildExportMap(
  opts: CompositionOptions,
  paneW: number,
  paneH: number,
): Promise<ExportMap> {
  if (paneW < 2 || paneH < 2 || opts.track.length === 0) return NO_MAP;

  const maplibregl = (await import('maplibre-gl')).default;
  await import('maplibre-gl/dist/maplibre-gl.css');

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${paneW}px;height:${paneH}px`;
  document.body.appendChild(container);

  const map = new maplibregl.Map({
    container,
    style: COMPOSER_STYLE,
    attributionControl: false,
    interactive: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  const dispose = () => {
    map.remove();
    container.remove();
  };

  try {
    await new Promise<void>((res) => map.once('load', () => res()));
    addTrackLine(map, opts.track);
    setTiles(map, opts.tilesOn);
    const cam = cameraForTrack(map, opts.track);
    if (cam) map.jumpTo({ center: cam.center, zoom: Math.max(0, cam.zoom + opts.zoomOffset) });
    map.resize();
    await awaitIdle(map, 3000);

    const base = document.createElement('canvas');
    base.width = paneW;
    base.height = paneH;
    const ctx = base.getContext('2d');
    if (ctx) ctx.drawImage(map.getCanvas(), 0, 0, paneW, paneH);

    return {
      base,
      project: (pos) => {
        const p = map.project(pos);
        return { x: p.x, y: p.y };
      },
      dispose,
    };
  } catch {
    dispose();
    return NO_MAP;
  }
}

/** Render and download the composition as an MP4. */
export async function exportComposition(
  file: File,
  opts: CompositionOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const outW = even(opts.outW);
  const outH = even(opts.outH);
  const rects = paneRects(outW, outH, opts.layout, opts.split, opts.inset, opts.corner);

  // Read the clip up front — while its handle is freshest, and so an unreadable
  // file fails fast (before the map setup) with a clear, recoverable error.
  const buffer = await file.arrayBuffer();

  const exportMap = await buildExportMap(opts, rects.map.w, rects.map.h);
  const markerR = Math.max(4, Math.round(outH * 0.008));

  try {
    return await exportProcessedVideo(
      buffer,
      ({ codedWidth, codedHeight, rotation }): FrameProcessor => {
        const canvas = makeExportCanvas(outW, outH);
        const ctx = canvas.getContext('2d') as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (!ctx) throw new Error('Could not create a 2D canvas for export.');

        const displayW = rotation === 90 || rotation === 270 ? codedHeight : codedWidth;
        const displayH = rotation === 90 || rotation === 270 ? codedWidth : codedHeight;
        const upright = makeExportCanvas(displayW, displayH);
        const uctx = upright.getContext('2d') as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        const grade = opts.lut
          ? makeFrameGrader(opts.lut, codedWidth, codedHeight, opts.intensity)
          : null;

        const drawVideo = (frame: VideoFrame) => {
          if (!uctx) return;
          const src = grade ? grade.render(frame) : frame;
          drawRotatedFrame(uctx, src, codedWidth, codedHeight, rotation, displayW, displayH);
          const f = fitRect(displayW, displayH, rects.video, opts.videoFit);
          ctx.drawImage(upright, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
        };

        const drawMap = (cue: Cue | null) => {
          if (exportMap.base) {
            const f = fitRect(exportMap.base.width, exportMap.base.height, rects.map, 'cover');
            ctx.drawImage(exportMap.base, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
          }
          const pos = cue && parsePosition(cue);
          const fallback = opts.track.length
            ? ([opts.track[0].lon, opts.track[0].lat] as [number, number])
            : null;
          const at = pos || fallback;
          if (!at) return;
          const pix = exportMap.project(at);
          if (!pix || pix.x < 0 || pix.y < 0 || pix.x > rects.map.w || pix.y > rects.map.h) return;
          ctx.beginPath();
          ctx.arc(rects.map.x + pix.x, rects.map.y + pix.y, markerR, 0, Math.PI * 2);
          ctx.fillStyle = MAP_ACCENT;
          ctx.fill();
          ctx.lineWidth = Math.max(1, markerR * 0.33);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        };

        return {
          draw(frame, tMicros) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, outW, outH);
            const cue = findCue(opts.cues, tMicros / 1_000_000);
            if (opts.layout === 'pip-video') {
              drawMap(cue);
              drawVideo(frame);
            } else {
              drawVideo(frame);
              drawMap(cue);
            }
            drawReadout(ctx, cue, opts.readoutPos, outW, outH, opts.overlay);
            return canvas;
          },
          dispose() {
            grade?.dispose();
          },
        };
      },
      onProgress,
      signal,
      { outputSize: { width: outW, height: outH } },
    );
  } finally {
    exportMap.dispose();
  }
}

/** `clip.mp4` → `clip-composition.mp4`. */
export function compositionName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}-composition.mp4`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
