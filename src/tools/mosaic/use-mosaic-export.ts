import { useCallback, useRef, useState } from 'react';
import { exportCellPx, exportSize } from '../../shared/mosaic/export-size';
import type { MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import { encodeFrames } from '../../shared/media/render-video';
import { downloadBlob } from '../../shared/media/save';
import { isEncodeSupported } from '../../shared/media/webcodecs-export';
import { startTask } from '../../shared/tasks/tasks';
import type { MatchPool } from './match-pool';
import { MosaicPlayer, type QueueSource } from './mosaic-player';
import type { MatchSettings, SceneBuilder } from './scene-builder';

/** A film's frame rate: the screen saver's motion is slow, 30 is smooth and half the bytes of 60. */
export const FILM_FPS = 30;

export type ExportKind = 'png' | 'mp4';

export interface MosaicExport {
  /** A sentence while running, null when idle. */
  running: string | null;
  progress: number | null;
  note: string | null;
  cancel: () => void;
  run: (kind: ExportKind) => Promise<void>;
  /** Whether this browser can encode a film at all (WebCodecs' H.264). */
  canFilm: boolean;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function slug(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'mosaic'
  );
}

interface ExportInputs {
  doc: MosaicDoc;
  builder: SceneBuilder | null;
  pool: MatchPool | null;
  /** The stage's size now — the file keeps its shape. */
  stageW: number;
  stageH: number;
  /** The chain's queue as a film reads it: never written. */
  queue: QueueSource | undefined;
}

/**
 * Writing a mosaic out (M7, `docs/mosaic.md` §4.5): a PNG of the target's mosaic at the export's size, built by the
 * stage's own builder; or an MP4 of the motion — the opening and N steps — painted frame by frame by the player's
 * own painter through `encodeFrames` (H.264, no sound), on a player of its own so the stage is left alone. Both are a
 * task in the masthead with a Cancel, and download under the mosaic's name and the moment.
 */
export function useMosaicExport({ doc, builder, pool, stageW, stageH, queue }: ExportInputs): MosaicExport {
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const live = useRef({ doc, builder, pool, stageW, stageH, queue });
  live.current = { doc, builder, pool, stageW, stageH, queue };
  const cancel = useCallback(() => controller.current?.abort(), []);

  const run = useCallback(async (kind: ExportKind) => {
    const { doc: d, builder: b, pool: p, stageW: sw, stageH: sh, queue: q } = live.current;
    if (controller.current) return;
    if (!b || d.target === undefined) {
      setNote('Nothing to export yet — the mosaic needs a target.');
      return;
    }
    if (kind === 'mp4' && !isEncodeSupported()) {
      setNote('This browser cannot encode a film (no WebCodecs). The image still saves as PNG.');
      return;
    }
    if (kind === 'mp4' && d.settings.mode === 'single') {
      setNote('Choose a mode under the stage — Mosaics, Chain… — to film it.');
      return;
    }
    const s = d.settings;
    const { w, h } = exportSize(sw, sh, s.export.short);
    const cellPx = exportCellPx(s.export.cells, s.cellPx, sw, sh, w);
    const match: MatchSettings = { cellPx, level: s.level, space: s.space, tint: s.tint, distinctNeighbours: s.distinctNeighbours };
    const ctl = new AbortController();
    controller.current = ctl;
    setNote(null);
    const label = kind === 'mp4' ? `Mosaic · ${w}×${h} film` : `Mosaic · ${w}×${h} image`;
    const task = startTask({ label, progress: 0, cancel: () => ctl.abort() });
    setRunning(kind === 'mp4' ? 'Filming the chain…' : 'Building the image…');
    setProgress(0);
    try {
      let blob: Blob;
      let name: string;
      if (kind === 'png') {
        const scene = await b.build(d.target, match, { stageW: w, stageH: h, dpr: 1 }, {
          signal: ctl.signal,
          crop: d.crop,
          plan: p ? { pool: p, lot: 0, propagation: 'none', origin: -1, seed: s.seed } : undefined,
        });
        blob = await new Promise<Blob>((resolve, reject) => scene.canvas.toBlob((x) => (x ? resolve(x) : reject(new Error('The image could not be written.'))), 'image/png'));
        name = `${slug(d.title)}-${w}x${h}-${stamp()}.png`;
      } else {
        const player = new MosaicPlayer(b);
        const film = player.film(
          {
            mode: s.mode as Exclude<typeof s.mode, 'single'>,
            motion: s.motion,
            speed: s.speed,
            seed: s.seed,
            settings: match,
            from: d.target,
            crop: d.crop,
            pool: p,
            // Read, never written: a film must not change the document it films.
            queue: q ? { next: q.next, draw: q.draw, picked: q.picked } : undefined,
          },
          s.export.steps,
          { stageW: w, stageH: h, dpr: 1 },
          ctl.signal,
        );
        const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('This browser cannot draw the frame.');
        blob = await encodeFrames({
          width: w,
          height: h,
          seconds: film.seconds,
          fps: FILM_FPS,
          draw: async (t) => {
            await film.draw(t, ctx);
            return canvas;
          },
          signal: ctl.signal,
          onProgress: (pr) => {
            if (pr.ratio !== null) {
              setProgress(pr.ratio);
              task.update({ progress: pr.ratio, detail: `${Math.round(pr.ratio * 100)} %` });
            }
          },
        });
        name = `${slug(d.title)}-${w}x${h}-${stamp()}.mp4`;
      }
      downloadBlob(blob, name);
      setNote(`Saved ${name} (${blob.size < 1_048_576 ? `${Math.max(1, Math.round(blob.size / 1024))} KB` : `${(blob.size / 1_048_576).toFixed(1)} MB`}).`);
    } catch (err) {
      if (ctl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) setNote('Export cancelled — nothing was saved.');
      else {
        const message = err instanceof Error ? err.message : String(err);
        setNote(/cannot encode/i.test(message) ? `${message.replace(/ The slides still export as images\.?/, '')} The image still saves as PNG.` : message);
      }
    } finally {
      task.done();
      controller.current = null;
      setRunning(null);
      setProgress(null);
    }
  }, []);

  return { running, progress, note, cancel, run, canFilm: typeof window !== 'undefined' && isEncodeSupported() };
}
