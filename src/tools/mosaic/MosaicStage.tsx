import { useEffect, useRef, useState } from 'react';
import { drawGrid, drawTarget } from './mosaic-paint';
import type { SceneState } from './use-mosaic-scene';

export interface StageView {
  /** The cell lines over the mosaic. */
  grid: boolean;
  /** The target's picture over the mosaic, 0..1 — to check how the mosaic reads. */
  ghost: number;
}

interface MosaicStageProps {
  state: SceneState;
  view: StageView;
  /** The stage's logical size, as measured by the parent; the canvas fills it. */
  stageW: number;
  stageH: number;
  dpr: number;
  /** A cell was clicked: the picture index it shows. */
  onPick: (pictureIndex: number) => void;
  /** The player draws the frames: the stage keeps its hands off the canvas. */
  playing?: boolean;
  /** The canvas, for the player to draw into. */
  canvasOut?: (el: HTMLCanvasElement | null) => void;
}

/**
 * The stage in SINGLE mode (`docs/mosaic.md` §5): the mosaic painted once by
 * the scene, the target's ghost and the grid over it; a click on a cell
 * makes its picture the target. While a build runs, the previous mosaic
 * stays and the word says what is being done.
 */
export default function MosaicStage({ state, view, stageW, stageH, dpr, onPick, playing = false, canvasOut }: MosaicStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const scene = state.status === 'ready' ? state.scene : state.status === 'building' || state.status === 'failed' ? state.previous : null;

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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#100f0d';
    ctx.fillRect(0, 0, w, h);
    if (!scene) return;
    // A scene built for another size is stretched until the new one lands.
    ctx.drawImage(scene.canvas, 0, 0, w, h);
    if (view.ghost > 0) drawTarget(ctx, scene.target, stageW, stageH, dpr, view.ghost);
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
  }, [scene, view.ghost, view.grid, stageW, stageH, dpr, hover, playing]);

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
          if (index >= 0) onPick(index);
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
    </div>
  );
}
