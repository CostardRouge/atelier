/**
 * The PLAYER of the animated modes (`docs/mosaic.md` §5): Dézoom, the
 * Chain (in · out · alternate), the Reveal and the Drift, over the scenes
 * the builder makes and the clock `shared/mosaic/chain.ts` keeps. It owns a
 * frame loop drawing into the stage's canvas, and nothing in that loop
 * accumulates: every frame is a function of the time since the step began.
 *
 * A step is prepared AHEAD: the moment a step starts, the next picture is
 * chosen and its scene built (its proxy fetched, matched, painted) while
 * the current step plays; a step that ends before the next scene is ready
 * holds on its last frame until it is. The picks come from the document's
 * seed, so Play twice shows the same chain.
 */

import { mulberry32 } from '../../shared/lib/prng';
import {
  cameraAt,
  cellRect,
  driftCamera,
  revealAt,
  revealOrder,
  stepKind,
  stepStateAt,
  type Camera,
  type ChainKind,
} from '../../shared/mosaic/chain';
import { pickCell, pickNextTarget } from '../../shared/mosaic/match';
import { coverSource } from '../../shared/mosaic/measure';
import type { Crop } from '../../shared/mosaic/frame';
import type { ChainDirection, MosaicMode } from '../../shared/mosaic/mosaic-doc';
import { drawGrid, drawTarget } from './mosaic-paint';
import type { MatchPool } from './match-pool';
import type { BuildPlan, MatchSettings, MosaicScene, SceneBuilder, StageSize } from './scene-builder';

export interface PlayerOptions {
  mode: Exclude<MosaicMode, 'single'>;
  direction: ChainDirection;
  speed: number;
  seed: number;
  settings: MatchSettings;
  /** The picture on screen when Play was pressed. */
  from: number;
  /** The cell lines over the mosaic while playing. */
  grid?: boolean;
  /** The part of `from` the frame rebuilds; the pictures after it are framed whole. */
  crop?: Crop;
  /** The matching pool, so a step ahead is matched off the main thread. */
  pool?: MatchPool | null;
  /** The chain's queue in the document (lab 2, R6); without one the player draws every step itself. */
  queue?: QueueSource;
  /** How many steps are prepared past the one playing (the Performance panel's `ahead`, 1–3). */
  ahead?: number;
}

/**
 * The document's queue as the player reads it: the picture step `index`
 * ends on, read when the step is PREPARED (so an edit of a later entry is
 * honoured); `undefined` past the end — the player then draws one itself and
 * reports it when `draw` is on, or ends the chain when it is off.
 */
export interface QueueSource {
  next: (index: number) => number | undefined;
  draw: boolean;
  onDraw?: (index: number, id: number) => void;
}

/** What the player says of itself, for the status line. */
export interface PlayerStatus {
  playing: boolean;
  /** The picture on screen (or about to be), its asset id. */
  current: number;
  stepIndex: number;
  /** Steps played to their end this run — what the queue has consumed. */
  done: number;
  phase: string;
  /** The next scene is not ready yet and the step waits on its last frame. */
  waiting: boolean;
  error: string | null;
  /** Why a run ended by itself, when it did — not an error. */
  note: string | null;
}

export const IDLE_STATUS: PlayerStatus = { playing: false, current: -1, stepIndex: 0, done: 0, phase: '', waiting: false, error: null, note: null };

interface ChainStep {
  kind: ChainKind;
  /** The scene the step plays over (kind in: the current picture's; out: the NEXT picture's, the current forced into a cell). */
  scene: MosaicScene;
  cell: number;
  /** The picture the step ends on. */
  next: number;
  /** Its bitmap — the focus cell's crisp picture (in), or the picture pulled back from (out). */
  focus: ImageBitmap;
  /** For a zoom-out: the picture pulled back from, drawn crisp at the start. */
  nextScene: Promise<ChainStep | null> | null;
}

const HOLD_LAST_MS = 1100;

export class MosaicPlayer {
  private canvas: HTMLCanvasElement | null = null;
  private size: StageSize = { stageW: 0, stageH: 0, dpr: 1 };
  private raf = 0;
  private controller: AbortController | null = null;
  private rnd: () => number = Math.random;
  private history: number[] = [];
  private status: PlayerStatus = IDLE_STATUS;
  private listeners = new Set<(s: PlayerStatus) => void>();

  constructor(private builder: SceneBuilder) {}

  attach(canvas: HTMLCanvasElement | null, size: StageSize): void {
    this.canvas = canvas;
    this.size = size;
  }

  subscribe(fn: (s: PlayerStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  get playing(): boolean {
    return this.status.playing;
  }

  /** The picture on screen now — what the document's target becomes when Play stops. */
  get current(): number {
    return this.status.current;
  }

  private say(patch: Partial<PlayerStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  private remember(id: number): void {
    this.history.push(id);
    if (this.history.length > 12) this.history.shift();
  }

  start(opts: PlayerOptions): void {
    this.stop();
    this.rnd = mulberry32(opts.seed);
    this.history = [opts.from];
    this.controller = new AbortController();
    this.say({ playing: true, current: opts.from, stepIndex: 0, done: 0, phase: 'starting', waiting: false, error: null, note: null });
    const signal = this.controller.signal;
    void this.run(opts, signal).catch((e: unknown) => {
      if (signal.aborted) return;
      this.say({ playing: false, error: e instanceof Error ? e.message : String(e) });
      this.stop();
    });
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.status.playing) this.say({ playing: false, phase: '', waiting: false });
  }

  /** A step's build: the whole mosaic in one lot on the pool — nothing is shown while it is prepared. */
  private planFor(opts: PlayerOptions): BuildPlan | undefined {
    return opts.pool ? { pool: opts.pool, lot: 0, propagation: 'none', origin: -1, seed: opts.seed } : undefined;
  }

  private async run(opts: PlayerOptions, signal: AbortSignal): Promise<void> {
    if (opts.mode === 'drift') return this.runDrift(opts, signal);
    if (opts.mode === 'reveal') return this.runReveal(opts, signal);
    // Dézoom: one step out. Chain: endless, the direction's kinds.
    let index = 0;
    let current = opts.from;
    const ahead = Math.max(1, Math.min(3, Math.round(opts.ahead ?? 1)));
    /**
     * The steps in preparation, by index — `ahead` of them past the one
     * playing, each chained on the one before (its picture is where the next
     * starts). A step abandoned by a Stop before it is awaited must not
     * surface its abort as an unhandled rejection; a step played is dropped,
     * or a long chain would hold every scene it ever drew.
     */
    const pendings = new Map<number, Promise<ChainStep | 'end' | null>>();
    const ensure = (upTo: number) => {
      for (let k = pendings.size ? Math.max(...pendings.keys()) + 1 : 0; k <= upTo; k++) {
        const kind: ChainKind | null = opts.mode === 'dezoom' ? (k === 0 ? 'out' : null) : stepKind(opts.direction, k);
        const before = k === 0 ? Promise.resolve<ChainStep | 'end' | null>({ next: opts.from } as ChainStep) : (pendings.get(k - 1) ?? Promise.resolve(null));
        const p = kind
          ? before.then((prev) => (prev && prev !== 'end' ? this.prepare(kind, prev.next, k, opts, signal, k === 0 ? opts.crop : undefined) : prev === 'end' ? 'end' : null))
          : Promise.resolve<ChainStep | 'end' | null>(null);
        p.catch(() => undefined);
        pendings.set(k, p);
      }
    };
    for (;;) {
      ensure(index + ahead);
      this.warm(index, opts, signal);
      this.say({ waiting: true, phase: 'preparing' });
      const step = await pendings.get(index)!;
      if (signal.aborted) return;
      if (step === 'end') {
        this.say({ playing: false, phase: 'done', note: index ? 'The chain ended at the last picked picture.' : 'Nothing queued: pick a picture, or let the chain draw the next ones.' });
        return;
      }
      if (!step) {
        this.say({ playing: false, error: 'No other picture to go to.' });
        return;
      }
      this.say({ waiting: false, stepIndex: index, current });
      await this.playStep(step, opts, signal);
      if (signal.aborted) return;
      pendings.delete(index);
      current = step.next;
      this.remember(current);
      index += 1;
      this.say({ current, done: index });
      if (opts.mode === 'dezoom') {
        this.say({ playing: false, phase: 'done' });
        return;
      }
    }
  }

  /**
   * The proxies of the two queued pictures past the scenes ahead, fetched
   * while this step plays (lab 2, F7): a build that reaches them finds the
   * bitmap here. Only what the queue already names — a drawn step is
   * unknown until its turn — and never a reason to wait or to fail.
   */
  private warm(index: number, opts: PlayerOptions, signal: AbortSignal): void {
    if (!opts.queue || opts.mode === 'dezoom') return;
    const ahead = Math.max(1, Math.min(3, Math.round(opts.ahead ?? 1)));
    const tiles = this.builder.tiles;
    for (let k = index + ahead; k < index + ahead + 2; k++) {
      const id = opts.queue.next(k);
      const tile = id === undefined ? undefined : tiles.find((t) => t.id === id);
      if (tile) void this.builder.targetBitmap(tile, signal).catch(() => undefined);
    }
  }

  /**
   * The picture step `index` ends on: the queue's when it has one, else drawn
   * here by colour (a well-matched cell near the centre for a dive, a picture
   * holding the current one's mean for a pull-back) and reported, or `'end'`
   * when the queue is out and says not to draw.
   */
  private nextFor(kind: ChainKind, index: number, fromIndex: number, scene: MosaicScene | null, opts: PlayerOptions): number | 'end' | null {
    const tiles = this.builder.tiles;
    const queued = opts.queue?.next(index);
    if (queued !== undefined) {
      const i = tiles.findIndex((t) => t.id === queued);
      if (i >= 0 && i !== fromIndex) return i;
    }
    if (opts.queue && !opts.queue.draw) return 'end';
    let next: number;
    if (kind === 'in' && scene) {
      const cell = pickCell(scene.matching, scene.shape.cols, scene.shape.rows, { target: fromIndex, history: this.historyIndexes(), rnd: this.rnd });
      if (cell < 0) return null;
      next = scene.matching.ids[cell];
    } else next = pickNextTarget(this.builder.labGrids(), tiles.length, fromIndex, { history: this.historyIndexes(), rnd: this.rnd });
    if (next < 0) return null;
    opts.queue?.onDraw?.(index, tiles[next].id);
    return next;
  }

  /** The step that takes the chain from `from`: its next picture chosen, its scene built. */
  private async prepare(kind: ChainKind, from: number, index: number, opts: PlayerOptions, signal: AbortSignal, crop?: Crop): Promise<ChainStep | 'end' | null> {
    const tiles = this.builder.tiles;
    const fromIndex = tiles.findIndex((t) => t.id === from);
    if (fromIndex < 0 || tiles.length < 2) return null;
    if (kind === 'in') {
      // The current picture's mosaic first; a queued next picture is forced into the cell it resembles most (or keeps its own cell).
      const queued = opts.queue?.next(index);
      const queuedIndex = queued === undefined ? -1 : tiles.findIndex((t) => t.id === queued);
      const scene = await this.builder.build(from, opts.settings, this.size, { signal, crop, plan: this.planFor(opts), force: queuedIndex >= 0 && queuedIndex !== fromIndex ? queuedIndex : undefined });
      const nextIndex = this.nextFor(kind, index, fromIndex, scene, opts);
      if (nextIndex === 'end' || nextIndex === null) return nextIndex;
      let cell = scene.forcedCell ?? -1;
      if (cell < 0 || scene.matching.ids[cell] !== nextIndex) {
        cell = -1;
        for (let c = 0; c < scene.matching.ids.length; c++) if (scene.matching.ids[c] === nextIndex) cell = c;
        if (cell < 0) return null;
      }
      const next = tiles[nextIndex].id;
      const focus = await this.builder.targetBitmap(tiles[nextIndex], signal);
      return { kind, scene, cell, next, focus, nextScene: null };
    }
    const nextIndex = this.nextFor(kind, index, fromIndex, null, opts);
    if (nextIndex === 'end' || nextIndex === null) return nextIndex;
    const next = tiles[nextIndex].id;
    const scene = await this.builder.build(next, opts.settings, this.size, { signal, force: fromIndex, plan: this.planFor(opts) });
    const focus = await this.builder.targetBitmap(tiles[fromIndex], signal);
    return { kind, scene, cell: scene.forcedCell ?? 0, next, focus, nextScene: null };
  }

  private historyIndexes(): number[] {
    const tiles = this.builder.tiles;
    return this.history.map((id) => tiles.findIndex((t) => t.id === id)).filter((i) => i >= 0);
  }

  /** One step drawn frame by frame until its clock says it is over. */
  private playStep(step: ChainStep, opts: PlayerOptions, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const t0 = performance.now();
      const frame = (now: number) => {
        if (signal.aborted) return resolve();
        const state = stepStateAt(step.kind, opts.speed, now - t0);
        if (state.phase !== this.status.phase) this.say({ phase: state.phase });
        // A pull-back shows the NEXT picture from its resolve on: a Stop there keeps what is seen.
        if (step.kind === 'out' && (state.phase === 'hold' || (state.phase === 'resolve' && state.f >= 0.5)) && this.status.current !== step.next) this.say({ current: step.next });
        this.drawChainFrame(step, cameraAt(state, cellRect(step.cell, step.scene.shape.cols, step.scene.shape.cw, step.scene.shape.ch), step.scene.stageW, step.scene.stageH), opts);
        if (state.done) return resolve();
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  private context(): { ctx: CanvasRenderingContext2D; W: number; H: number; dpr: number } | null {
    const canvas = this.canvas;
    if (!canvas) return null;
    const { stageW: W, stageH: H, dpr } = this.size;
    const w = Math.max(1, Math.round(W * dpr));
    const h = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#100f0d';
    ctx.fillRect(0, 0, w, h);
    return { ctx, W, H, dpr };
  }

  /** The mosaic through the camera, the focus cell's crisp picture, the target over it. */
  private drawChainFrame(step: ChainStep, cam: Camera, opts: PlayerOptions): void {
    const c = this.context();
    if (!c) return;
    const { ctx, W, H, dpr } = c;
    const { scene } = step;
    // The scene was built for its own size; the camera is in that space, scaled to the canvas.
    const kx = W / scene.stageW;
    const ky = H / scene.stageH;
    if (cam.mosaic) {
      ctx.setTransform(dpr * kx * cam.s, 0, 0, dpr * ky * cam.s, dpr * kx * (scene.stageW / 2 - cam.vx * cam.s), dpr * ky * (scene.stageH / 2 - cam.vy * cam.s));
      ctx.drawImage(scene.canvas, 0, 0, scene.stageW, scene.stageH);
      if (opts.grid) {
        ctx.strokeStyle = 'rgba(244,240,231,0.35)';
        ctx.lineWidth = 1 / (dpr * cam.s);
        ctx.beginPath();
        for (let i = 1; i < scene.shape.cols; i++) {
          ctx.moveTo(i * scene.shape.cw, 0);
          ctx.lineTo(i * scene.shape.cw, scene.stageH);
        }
        for (let j = 1; j < scene.shape.rows; j++) {
          ctx.moveTo(0, j * scene.shape.ch);
          ctx.lineTo(scene.stageW, j * scene.shape.ch);
        }
        ctx.stroke();
      }
      if (cam.focus > 0) {
        const r = cellRect(step.cell, scene.shape.cols, scene.shape.cw, scene.shape.ch);
        const src = coverSource(step.focus.width, step.focus.height, r.w, r.h);
        ctx.globalAlpha = cam.focus;
        ctx.drawImage(step.focus, src.x, src.y, src.w, src.h, r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      }
    }
    if (cam.target > 0) drawTarget(ctx, scene.target, W, H, dpr, cam.target, scene.targetRect);
  }

  private async runReveal(opts: PlayerOptions, signal: AbortSignal): Promise<void> {
    let current = opts.from;
    let index = 0;
    const tiles = this.builder.tiles;
    for (;;) {
      this.say({ waiting: true, phase: 'preparing', stepIndex: index, current });
      const scene = await this.builder.build(current, opts.settings, this.size, { signal, crop: index === 0 ? opts.crop : undefined, plan: this.planFor(opts) });
      if (signal.aborted) return;
      const count = scene.shape.cols * scene.shape.rows;
      const order = revealOrder(scene.shape.cols, scene.shape.rows, this.rnd);
      this.say({ waiting: false });
      await new Promise<void>((resolve) => {
        const t0 = performance.now();
        const frame = (now: number) => {
          if (signal.aborted) return resolve();
          const r = revealAt(now - t0, opts.speed, count);
          if (r.phase !== this.status.phase) this.say({ phase: r.phase });
          const c = this.context();
          if (c) {
            const { ctx, W, H, dpr } = c;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.drawImage(scene.canvas, 0, 0, W, H);
            if (r.flipped >= count) drawTarget(ctx, scene.target, W, H, dpr, 1, scene.targetRect);
            else if (r.flipped > 0) {
              const src = scene.targetRect;
              const { cols, cw, ch } = scene.shape;
              const kx = W / scene.stageW;
              const ky = H / scene.stageH;
              for (let q = 0; q < r.flipped; q++) {
                const cell = order[q];
                const i = cell % cols;
                const j = (cell - i) / cols;
                const x = i * cw * kx;
                const y = j * ch * ky;
                const w = cw * kx;
                const h = ch * ky;
                ctx.drawImage(scene.target, src.x + (x / W) * src.w, src.y + (y / H) * src.h, (w / W) * src.w, (h / H) * src.h, x, y, w + 0.5, h + 0.5);
              }
            }
            if (opts.grid && r.flipped < count) drawGrid(ctx, scene.shape, W, H, dpr);
          }
          if (r.done) return resolve();
          this.raf = requestAnimationFrame(frame);
        };
        this.raf = requestAnimationFrame(frame);
      });
      if (signal.aborted) return;
      this.remember(current);
      index += 1;
      this.say({ done: index });
      const others = tiles.filter((t) => t.id !== current && !this.history.includes(t.id));
      const pool = others.length ? others : tiles.filter((t) => t.id !== current);
      if (!pool.length) {
        this.say({ playing: false, phase: 'done' });
        return;
      }
      current = pool[Math.floor(this.rnd() * pool.length)].id;
    }
  }

  private async runDrift(opts: PlayerOptions, signal: AbortSignal): Promise<void> {
    this.say({ waiting: true, phase: 'preparing' });
    const scene = await this.builder.build(opts.from, opts.settings, this.size, { signal, crop: opts.crop, plan: this.planFor(opts) });
    if (signal.aborted) return;
    this.say({ waiting: false, phase: 'drifting' });
    const t0 = performance.now();
    const frame = (now: number) => {
      if (signal.aborted) return;
      const cam = driftCamera(((now - t0) / 1000) * opts.speed, scene.stageW, scene.stageH);
      this.drawChainFrame({ kind: 'in', scene, cell: 0, next: opts.from, focus: scene.target, nextScene: null }, { ...cam, focus: 0 }, opts);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
}

export { HOLD_LAST_MS };
