import { useCallback, useRef, useState } from 'react';
import { encodeFrames } from '../../shared/media/render-video';
import { downloadBlob } from '../../shared/media/save';
import { ensureFontFaces } from '../../shared/overlay/fonts';
import { startTask } from '../../shared/tasks/tasks';
import { HUD_FONT_FACES, paintAtlas, type PaintScene } from './atlas-paint';
import { AtlasTiles } from './atlas-tiles';
import { aspectRatio, mapRect, type AtlasSettings } from './atlas-settings';
import { visibleBox, type AtlasView } from './atlas-view';
import type { SceneCore } from './use-atlas-scene';

export type ExportKind = 'mp4' | 'still' | 'poster';

export interface ExportRequest {
  kind: ExportKind;
  /** For a still: the instant drawn. */
  at: number;
}

export interface AtlasExport {
  /** A sentence while running, null when idle. */
  running: string | null;
  progress: number | null;
  note: string | null;
  cancel: () => void;
  run: (req: ExportRequest, core: SceneCore, viewAt: (t: number) => AtlasView, tilesOn: boolean) => Promise<void>;
}

/** The frame's pixel size for an aspect and a short side, both even (H.264 refuses odd). */
export function exportSize(aspect: AtlasSettings['format']['aspect'], short: number): { w: number; h: number } {
  const ar = aspectRatio(aspect);
  const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
  return ar >= 1 ? { w: even(short * ar), h: even(short) } : { w: even(short), h: even(short / ar) };
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Writing the atlas out: an MP4 painted frame by frame by the preview's own
 * painter (`encodeFrames`, H.264, no sound — there is none to copy), or one
 * PNG — the frame on screen, or a POSTER with every route drawn whole. With
 * the map on, every frame waits for its tiles before it is painted, so a
 * file never shows a hole the preview filled later. Downloaded, named after
 * the moment; a task in the masthead with a Cancel while it runs.
 */
export function useAtlasExport(settings: AtlasSettings): AtlasExport {
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const run = useCallback<AtlasExport['run']>(
    async (req, core, viewAt, tilesOn) => {
      if (controller.current) return;
      if (!core.flights.length) {
        setNote('Nothing to export — no flight is shown.');
        return;
      }
      const ctl = new AbortController();
      controller.current = ctl;
      setNote(null);
      const { w, h } = exportSize(settings.format.aspect, settings.format.short);
      const label = req.kind === 'mp4' ? `Flight Atlas · ${w}×${h} video` : `Flight Atlas · ${w}×${h} image`;
      const task = startTask({ label, progress: 0, cancel: () => ctl.abort() });
      setRunning(req.kind === 'mp4' ? 'Rendering the video…' : 'Rendering the image…');
      setProgress(0);
      const tiles = tilesOn ? new AtlasTiles() : null;
      tiles?.setTone(settings.map.tileTone);
      try {
        const ts = core.settings.hud.theme.style;
        await ensureFontFaces([...HUD_FONT_FACES, `${ts.italic ? 'italic ' : ''}${ts.weight} 32px '${ts.fontFamily}'`]);
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
        if (!ctx) throw new Error('This browser cannot draw the frame.');
        const scene: PaintScene = { ...core, tiles, focus: null };
        const look = { bearing: settings.camera.bearing, tilt: settings.camera.tilt };
        const paint = async (t: number, poster = false) => {
          const view = viewAt(t);
          // The view is the MAP's, inside the mount.
          const r = mapRect(settings.format, w, h);
          if (tiles) await tiles.ready(visibleBox(view, look, r.w, r.h), view.scale * Math.min(r.w, r.h));
          if (ctl.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
          paintAtlas(ctx, scene, { t, view, width: w, height: h, poster });
          return canvas;
        };

        let blob: Blob;
        let name: string;
        if (req.kind === 'mp4') {
          blob = await encodeFrames({
            width: w,
            height: h,
            seconds: core.schedule.total,
            fps: settings.format.fps,
            draw: (t) => paint(t),
            signal: ctl.signal,
            onProgress: (p) => {
              if (p.ratio !== null) {
                setProgress(p.ratio);
                task.update({ progress: p.ratio, detail: `${Math.round(p.ratio * 100)} %` });
              }
            },
          });
          name = `flight-atlas-${stamp()}.mp4`;
        } else {
          const drawn = await paint(req.kind === 'poster' ? core.schedule.total : req.at, req.kind === 'poster');
          blob =
            'convertToBlob' in drawn
              ? await drawn.convertToBlob({ type: 'image/png' })
              : await new Promise<Blob>((resolve, reject) => (drawn as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be written.'))), 'image/png'));
          name = `flight-atlas-${req.kind === 'poster' ? 'poster-' : ''}${stamp()}.png`;
        }
        downloadBlob(blob, name);
        setNote(`Saved ${name} (${(blob.size / 1_048_576).toFixed(1)} MB).`);
      } catch (err) {
        if (ctl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) setNote('Export cancelled — nothing was saved.');
        else {
          const message = err instanceof Error ? err.message : String(err);
          // The encoder's own sentence speaks of a deck's slides; the atlas has frames.
          setNote(/cannot encode/i.test(message) ? `${message.replace(/ The slides still export as images\.?/, '')} This frame and the poster still save as PNG.` : message);
        }
      } finally {
        tiles?.dispose();
        task.done();
        controller.current = null;
        setRunning(null);
        setProgress(null);
      }
    },
    [settings.format, settings.camera.bearing, settings.camera.tilt, settings.map.tileTone],
  );

  return { running, progress, note, cancel, run };
}
