import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CellAnimation } from '../../shared/mosaic/perf';
import { needsCellPass } from '../../shared/mosaic/zoom-detail';
import type { SharpPictures } from './sharp-pictures';
import { cellDevicePx, paintZoomCells, type ZoomCellsOptions } from './zoom-cells';
import { IDENTITY_VIEW, isIdentityView, pictureArea, stagePointToMosaic, viewWindow, type StageView as ZoomView } from '../../shared/mosaic/stage-view';
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
  /** A cell was clicked while a run plays: steer the chain there (the player decides whether it can). */
  onSteer?: (cell: number) => void;
  /** The frames a propagation drew per second, once it settled — the panel's measure. */
  onFps?: (fps: number) => void;
  /** The zoom over the stage while the hand moves, or once a zoom is kept to look (F6); identity draws the mosaic as built. */
  zoom?: ZoomView;
  /** The player draws the frames: the stage keeps its hands off the canvas. */
  playing?: boolean;
  /** The canvas, for the player to draw into. */
  canvasOut?: (el: HTMLCanvasElement | null) => void;
  /** A drag just ended: its trailing click is not a pick (lab 4, L3). */
  swallowClick?: () => boolean;
  /** A drag would move the view: the cursor is a hand. */
  pannable?: boolean;
  /**
   * The box the zoom's gestures listen on: a pointer they capture (a mouse that may start a drag) sends its click
   * THERE, not to the canvas, so the stage hears its clicks on it — they bubble to it from the canvas otherwise.
   */
  clickHost?: RefObject<HTMLElement | null>;
  /** What a zoom's cells are drawn from (lab 4, L4): sharp pictures as they grow, the veil fading; none = the mosaic enlarged. */
  detail?: ZoomDetail;
}

export interface ZoomDetail extends ZoomCellsOptions {
  pictures: SharpPictures;
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
export default function MosaicStage({ state, view, stageW, stageH, dpr, reveal, onPick, onSteer, onFps, zoom = IDENTITY_VIEW, playing = false, canvasOut, swallowClick, pannable = false, clickHost, detail }: MosaicStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const scene = state.status === 'ready' ? state.scene : state.status === 'building' || state.status === 'failed' ? state.previous : null;
  const tick = state.status === 'ready' ? state.tick : 0;
  const progress = state.status === 'building' ? 0 : state.status === 'ready' ? state.scene.progress : 1;
  const fpsRef = useRef<{ frames: number; since: number } | null>(null);
  // A sharp picture landed: the zoomed cells are drawn again.
  const [sharpTick, setSharpTick] = useState(0);
  const pictures = detail?.pictures;
  useEffect(() => pictures?.subscribe(() => setSharpTick((t) => t + 1)), [pictures]);

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
      if (!isIdentityView(zoom)) {
        // Under a zoom the painted mosaic is only enlarged — free. Past the mosaic built (Auto-frame lets a drag slide
        // the frame across the target) the picture itself shows, dimmed, where the next build will read.
        const win = viewWindow(zoom, stageW, stageH);
        if (win.x < -0.5 || win.y < -0.5 || win.x + win.w > stageW + 0.5 || win.y + win.h > stageH + 0.5) {
          const a = pictureArea(scene.targetRect, scene.target.width, scene.target.height, stageW, stageH);
          ctx.globalAlpha = 0.45;
          ctx.drawImage(scene.target, (zoom.ox + a.x * zoom.s) * dpr, (zoom.oy + a.y * zoom.s) * dpr, a.w * zoom.s * dpr, a.h * zoom.s * dpr);
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(scene.canvas, 0, 0, scene.canvas.width, scene.canvas.height, zoom.ox * dpr, zoom.oy * dpr, w * zoom.s, h * zoom.s);
        // Close up, the cells in view one by one: sharper pictures as they grow, the veil fading (lab 4, L4).
        if (detail && needsCellPass(zoom.s, cellDevicePx(scene, stageW, zoom, dpr), scene.settings.tint, detail.sharp, detail.fade)) {
          detail.pictures.want(paintZoomCells(ctx, scene, zoom, stageW, stageH, dpr, detail));
        }
        if (hover !== null && scene.stageW === stageW) {
          const { cols, cw, ch } = scene.shape;
          const i = hover % cols;
          const j = (hover - i) / cols;
          ctx.save();
          ctx.setTransform(dpr * zoom.s, 0, 0, dpr * zoom.s, zoom.ox * dpr, zoom.oy * dpr);
          ctx.strokeStyle = '#d9442a';
          ctx.lineWidth = 2 / (dpr * zoom.s);
          ctx.strokeRect(i * cw + 1 / zoom.s, j * ch + 1 / zoom.s, cw - 2 / zoom.s, ch - 2 / zoom.s);
          ctx.restore();
        }
        return false;
      }
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
  }, [scene, tick, view.ghost, view.grid, stageW, stageH, dpr, hover, playing, reveal, onFps, zoom, detail, sharpTick]);

  /** The cell under the pointer — through the zoom, so it is the one drawn there at any scale; null off the mosaic. */
  const cellAt = (e: { clientX: number; clientY: number }): number | null => {
    const canvas = canvasRef.current;
    if (!scene || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const at = { x: ((e.clientX - rect.left) / rect.width) * stageW, y: ((e.clientY - rect.top) / rect.height) * stageH };
    const { x, y } = playing ? at : stagePointToMosaic(zoom, at);
    if (x < 0 || y < 0 || x >= stageW || y >= stageH) return null;
    const { cols, rows, cw, ch } = scene.shape;
    const i = Math.min(cols - 1, Math.max(0, Math.floor(x / cw)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor(y / ch)));
    return j * cols + i;
  };

  // A click: steer while a run plays, else pick the cell's picture — at any zoom; the one a drag's end sends is not a
  // click (lab 4, L3). Heard on the gestures' box when there is one (see `clickHost`), read through a ref.
  const onClickRef = useRef<(e: MouseEvent) => void>(() => undefined);
  onClickRef.current = (e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    if (playing) {
      const c = cellAt(e);
      if (c !== null) onSteer?.(c);
      return;
    }
    if (swallowClick?.()) return;
    const c = cellAt(e);
    if (c === null || !scene) return;
    const index = scene.matching.ids[c];
    if (index >= 0) onPick(index, c);
  };
  useEffect(() => {
    const host = clickHost?.current ?? canvasRef.current;
    if (!host) return;
    const listener = (e: MouseEvent) => onClickRef.current(e);
    host.addEventListener('click', listener);
    return () => host.removeEventListener('click', listener);
  }, [clickHost]);

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
        className={`block w-full h-full ${scene && !playing ? (pannable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer') : playing && onSteer ? 'cursor-crosshair' : ''}`}
        onMouseMove={(e) => setHover(playing || e.buttons ? null : cellAt(e))}
        onMouseLeave={() => setHover(null)}
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
