import { useEffect, useRef, useState } from 'react';
import type { CellAnimation } from '../../shared/mosaic/perf';
import { drawGrid, drawTarget } from './mosaic-paint';
import type { MosaicScene } from './scene-builder';
import type { SceneState } from './use-mosaic-scene';

export interface StageView {
  /** The cell lines over the mosaic. */
  grid: boolean;
  /** The target's picture over the mosaic, 0..1 — to check how the mosaic reads. */
  ghost: number;
}

export interface Reveal {
  animation: CellAnimation;
  /** How long a cell's animation lasts, ms; 0 or `none` draws at once. */
  ms: number;
}

interface MosaicStageProps {
  state: SceneState;
  view: StageView;
  /** The stage's logical size, as measured by the parent; the canvas fills it. */
  stageW: number;
  stageH: number;
  dpr: number;
  /** How a lot's cells come in (the Performance panel's say). */
  reveal: Reveal;
  /** A cell was clicked: the picture index it shows, and the cell. */
  onPick: (pictureIndex: number, cell: number) => void;
  /** The frames a propagation drew per second, once it settled — the panel's measure. */
  onFps?: (fps: number) => void;
  /** The player draws the frames: the stage keeps its hands off the canvas. */
  playing?: boolean;
  /** The canvas, for the player to draw into. */
  canvasOut?: (el: HTMLCanvasElement | null) => void;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * The cells of the lots younger than `ms` drawn mid-animation over the
 * finished mosaic: what they FADE from is the stage as it was before the
 * build (`scene.before`), else the dark ground. Returns whether anything is
 * still moving.
 */
function drawReveal(ctx: CanvasRenderingContext2D, scene: MosaicScene, reveal: Reveal, now: number, kx: number, ky: number, dpr: number): boolean {
  if (reveal.animation === 'none' || reveal.ms <= 0) return false;
  const { cols, cw, ch } = scene.shape;
  let moving = false;
  ctx.save();
  ctx.setTransform(dpr * kx, 0, 0, dpr * ky, 0, 0);
  for (const a of scene.arrivals) {
    const t = (now - a.at) / reveal.ms;
    if (t >= 1) continue;
    moving = true;
    const e = ease(t);
    for (let k = 0; k < a.cells.length; k++) {
      const c = a.cells[k];
      const i = c % cols;
      const j = (c - i) / cols;
      const x = i * cw;
      const y = j * ch;
      if (reveal.animation === 'fade') {
        ctx.globalAlpha = 1 - e;
        if (scene.before) ctx.drawImage(scene.before, x * scene.dpr, y * scene.dpr, cw * scene.dpr, ch * scene.dpr, x, y, cw + 0.5, ch + 0.5);
        else {
          ctx.fillStyle = '#100f0d';
          ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
        }
        ctx.globalAlpha = 1;
      } else {
        // appear: the new cell grows from its centre over the old; flip: it unfolds from its middle line.
        if (scene.before) ctx.drawImage(scene.before, x * scene.dpr, y * scene.dpr, cw * scene.dpr, ch * scene.dpr, x, y, cw + 0.5, ch + 0.5);
        else {
          ctx.fillStyle = '#100f0d';
          ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
        }
        const sx = reveal.animation === 'appear' ? 0.6 + 0.4 * e : 1;
        const sy = reveal.animation === 'appear' ? 0.6 + 0.4 * e : e;
        const w = cw * sx;
        const h = ch * sy;
        ctx.drawImage(scene.canvas, x * scene.dpr, y * scene.dpr, cw * scene.dpr, ch * scene.dpr, x + (cw - w) / 2, y + (ch - h) / 2, w + 0.5, h + 0.5);
      }
    }
  }
  ctx.restore();
  return moving;
}

/**
 * The stage in SINGLE mode (`docs/mosaic.md` §5): the mosaic painted by the
 * scene, lot by lot as the pool answers, each lot's cells animated in; the
 * target's ghost and the grid over it; a hairline along the bottom says how
 * far the lots have come (the `TaskEdge` rule: never a bare wait). A click
 * on a cell makes its picture the target. While a build runs, the previous
 * mosaic stays and the word says what is being done.
 */
export default function MosaicStage({ state, view, stageW, stageH, dpr, reveal, onPick, onFps, playing = false, canvasOut }: MosaicStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const scene = state.status === 'ready' ? state.scene : state.status === 'building' || state.status === 'failed' ? state.previous : null;
  const tick = state.status === 'ready' ? state.tick : 0;
  const progress = state.status === 'building' ? 0 : state.status === 'ready' ? state.scene.progress : 1;
  const fpsRef = useRef<{ frames: number; since: number } | null>(null);

  useEffect(() => {
    canvasOut?.(canvasRef.current);
    return () => canvasOut?.(null);
  }, [canvasOut]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || playing) return;
    const w = Math.max(1, Math.round(stageW * dpr));
    const h = Math.max(1, Math.round(stageH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#100f0d';
      ctx.fillRect(0, 0, w, h);
      if (!scene) return false;
      // A scene built for another size is stretched until the new one lands.
      ctx.drawImage(scene.canvas, 0, 0, w, h);
      const moving = drawReveal(ctx, scene, reveal, now, stageW / scene.stageW, stageH / scene.stageH, dpr);
      if (view.ghost > 0) drawTarget(ctx, scene.target, stageW, stageH, dpr, view.ghost, scene.targetRect);
      if (view.grid) drawGrid(ctx, scene.shape, stageW, stageH, dpr);
      if (hover !== null && scene.stageW === stageW) {
        const { cols, cw, ch } = scene.shape;
        const i = hover % cols;
        const j = (hover - i) / cols;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = '#d9442a';
        ctx.lineWidth = 2 / dpr;
        ctx.strokeRect(i * cw + 1, j * ch + 1, cw - 2, ch - 2);
        ctx.restore();
      }
      return moving;
    };
    const loop = (now: number) => {
      const moving = draw(now);
      const f = fpsRef.current ?? (fpsRef.current = { frames: 0, since: now });
      f.frames += 1;
      if (moving) raf = requestAnimationFrame(loop);
      else {
        const seconds = (now - f.since) / 1000;
        if (f.frames > 5 && seconds > 0.1) onFps?.(Math.round(f.frames / seconds));
        fpsRef.current = null;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scene, tick, view.ghost, view.grid, stageW, stageH, dpr, hover, playing, reveal, onFps]);

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    if (!scene) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * stageW;
    const y = ((e.clientY - rect.top) / rect.height) * stageH;
    const { cols, rows, cw, ch } = scene.shape;
    const i = Math.min(cols - 1, Math.max(0, Math.floor(x / cw)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor(y / ch)));
    return j * cols + i;
  };

  const word = playing
    ? null
    : state.status === 'building'
      ? { target: 'fetching the picture…', matching: 'matching…', tiles: 'gathering the tiles…', painting: 'painting…' }[state.step]
      : state.status === 'ready' && state.scene.progress < 1
        ? 'matching…'
        : state.status === 'failed'
          ? state.error
          : null;

  return (
    <div className="relative w-full h-full bg-frame rounded-paper-lg overflow-hidden shadow-paper-soft">
      <canvas
        ref={canvasRef}
        aria-label="Mosaic"
        className={`block w-full h-full ${scene && !playing ? 'cursor-crosshair' : ''}`}
        onMouseMove={(e) => setHover(playing ? null : cellAt(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (playing) return;
          const c = cellAt(e);
          if (c === null || !scene) return;
          const index = scene.matching.ids[c];
          if (index >= 0) onPick(index, c);
        }}
      />
      {word && (
        <span
          role="status"
          className={`absolute left-3 bottom-3 font-mono text-2xs px-2 py-1 rounded bg-frame/70 ${state.status === 'failed' ? 'text-danger' : 'text-on-media'}`}
        >
          {word}
        </span>
      )}
      {!playing && progress < 1 && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-paper/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Matching">
          <div className="h-full bg-accent transition-[width] duration-150 ease-linear" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
