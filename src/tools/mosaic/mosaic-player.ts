/**
 * The PLAYER of the animated modes (`docs/mosaic.md` §5, lab 3): one runner
 * over the step grammar of `shared/mosaic/motion.ts` — a departure from the
 * mosaic on screen, a trajectory, an arrival on the next — over the scenes
 * the builder makes. It owns a frame loop drawing into the stage's canvas,
 * and nothing in that loop accumulates: every frame is a function of the
 * time since the step began.
 *
 * A step is prepared AHEAD: the moment a step starts, the next pictures are
 * chosen and their scenes built (proxies fetched, matched, painted) while
 * the current step plays; a step whose scene is not ready when its turn
 * comes holds the last frame until it is, and says so. The pictures come
 * from the document's queue (`QueueSource`), the picks from its seed, so
 * Play twice shows the same chain.
 */

import { mulberry32 } from '../../shared/lib/prng';
import { cellRect, revealOrder, type CellRect } from '../../shared/mosaic/chain';
import { pickCell, pickNextTarget } from '../../shared/mosaic/match';
import { coverSource } from '../../shared/mosaic/measure';
import type { Crop } from '../../shared/mosaic/frame';
import type { MosaicMode } from '../../shared/mosaic/mosaic-doc';
import { ONCE, departAt, filmParts, playsOnce, stepFrameAt, type Motion, type StepDeparture, type StepFrame, type StepGeometry } from '../../shared/mosaic/motion';
import { drawGrid, drawTarget } from './mosaic-paint';
import type { MatchPool } from './match-pool';
import { cellOf, type BuildPlan, type MatchSettings, type MosaicScene, type SceneBuilder, type StageSize } from './scene-builder';

export interface PlayerOptions {
  mode: Exclude<MosaicMode, 'single'>;
  motion: Motion;
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
  /** A queued entry the person picked by hand: it wins over the aim. */
  picked?: (index: number) => boolean;
  /** The person steered the chain by a click: the entry becomes their pick. */
  onPick?: (index: number, id: number) => void;
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
  /** How long the last step took to be ready (its picture, its scene), ms — the Performance panel's measure. */
  prepMs: number | null;
  /** Steps this run that were not ready when their turn came, and the time spent holding for them. */
  waits: number;
  waitMs: number;
}

export const IDLE_STATUS: PlayerStatus = { playing: false, current: -1, stepIndex: 0, done: 0, phase: '', waiting: false, error: null, note: null, prepMs: null, waits: 0, waitMs: 0 };

/** One step, prepared: its two mosaics, the cells the camera aims at, and the orders its cells move in. */
interface Step {
  depart: StepDeparture;
  from: number;
  to: number;
  /** The mosaic of `from` — what a dive, a wave or a fade leaves. */
  sceneFrom: MosaicScene;
  /** The mosaic of `to` — what the step arrives on; a pull starts inside its cell holding `from`. */
  sceneTo: MosaicScene;
  geo: StepGeometry;
  /** The cell of `sceneFrom` a dive enters (and a wave spreads from), −1 when none. */
  cellA: number;
  /** The cell of `sceneTo` a pull starts in, −1 when none. */
  cellB: number;
  /** The order the arrived mosaic's cells land on the departed one (a wave). */
  waveOrder: Int32Array | null;
  /** The order the arrived mosaic's cells flip to its photo (a reveal). */
  revealOrder: Int32Array | null;
}

/** Scenes kept by picture while a run plays — the one on screen, the ones ahead, a few behind. */
const SCENES_HELD = 6;

export class MosaicPlayer {
  private canvas: HTMLCanvasElement | null = null;
  private size: StageSize = { stageW: 0, stageH: 0, dpr: 1 };
  private raf = 0;
  private controller: AbortController | null = null;
  private rnd: () => number = Math.random;
  private history: number[] = [];
  private status: PlayerStatus = IDLE_STATUS;
  private listeners = new Set<(s: PlayerStatus) => void>();
  private scenes = new Map<number, Promise<MosaicScene>>();
  /** Scenes kept by picture: fewer for a big film, whose scenes are tens of megabytes each. */
  private held = SCENES_HELD;
  /** The step and frame on screen, for a click to steer from. */
  private live: { step: Step; frame: StepFrame; index: number } | null = null;
  private liveOpts: PlayerOptions | null = null;
  /** Drops the steps prepared from `from` on and prepares them again — after a steer. */
  private replan: ((from: number) => void) | null = null;

  constructor(private builder: SceneBuilder) {}

  /**
   * A click on cell `cell` while a run plays (lab 3, the Steer recipe and
   * every other): when the arrived mosaic is on screen, the picture in that
   * cell becomes the next step's, as a pick of the queue, and the steps
   * prepared ahead are prepared again. False when the click cannot steer —
   * mid-dive, or on the picture already next.
   */
  steer(cell: number): boolean {
    const l = this.live;
    const q = this.liveOpts?.queue;
    if (!l || !q?.onPick || !l.frame.arrived || l.frame.base !== 'to') return false;
    const scene = l.step.sceneTo;
    const index = scene.matching.ids[cell];
    if (index === undefined || index < 0) return false;
    const id = scene.tiles[index].id;
    if (id === l.step.to || q.next(l.index + 1) === id) return false;
    q.onPick(l.index + 1, id);
    this.replan?.(l.index + 1);
    return true;
  }

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
    this.scenes = new Map();
    this.live = null;
    this.liveOpts = opts;
    this.controller = new AbortController();
    this.say({ playing: true, current: opts.from, stepIndex: 0, done: 0, phase: 'starting', waiting: false, error: null, note: null, prepMs: null, waits: 0, waitMs: 0 });
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
    this.live = null;
    this.replan = null;
  }

  /** A step's build: the whole mosaic in one lot on the pool — nothing is shown while it is prepared. */
  private planFor(opts: PlayerOptions): BuildPlan | undefined {
    return opts.pool ? { pool: opts.pool, lot: 0, propagation: 'none', origin: -1, seed: opts.seed } : undefined;
  }

  /** The mosaic of picture `id`, built once per run and kept for a while; `crop` only for the first. */
  private sceneOf(id: number, opts: PlayerOptions, signal: AbortSignal, crop?: Crop): Promise<MosaicScene> {
    const have = this.scenes.get(id);
    if (have) return have;
    const p = this.builder.build(id, opts.settings, this.size, { signal, crop, plan: this.planFor(opts) });
    p.catch(() => undefined);
    this.scenes.set(id, p);
    while (this.scenes.size > this.held) {
      const oldest = this.scenes.keys().next().value;
      if (oldest === undefined) break;
      this.scenes.delete(oldest);
    }
    return p;
  }

  private async run(opts: PlayerOptions, signal: AbortSignal): Promise<void> {
    const tiles = this.builder.tiles;
    if (tiles.length < 2 || !tiles.some((t) => t.id === opts.from)) {
      this.say({ playing: false, error: 'No other picture to go to.' });
      return;
    }
    const once = ONCE.has(opts.mode as (typeof ONCE extends ReadonlySet<infer T> ? T : never));
    const ahead = Math.max(1, Math.min(3, Math.round(opts.ahead ?? 1)));
    let index = 0;
    let current = opts.from;
    /**
     * The steps in preparation, by index — `ahead` of them past the one
     * playing, each chained on the one before (its picture is where the next
     * starts). A step abandoned by a Stop before it is awaited must not
     * surface its abort as an unhandled rejection; a step played is dropped,
     * or a long chain would hold every scene it ever drew.
     */
    const pendings = new Map<number, Promise<Step | 'end' | null>>();
    /** When each step's preparation could begin (the step before it was known), for the measure. */
    const since = new Map<number, number>();
    const ensure = (upTo: number) => {
      for (let k = pendings.size ? Math.max(...pendings.keys()) + 1 : 0; k <= upTo; k++) {
        if (once && k > 0) {
          pendings.set(k, Promise.resolve(null));
          continue;
        }
        const before = k === 0 ? Promise.resolve<Step | 'end' | null>({ to: opts.from } as Step) : (pendings.get(k - 1) ?? Promise.resolve(null));
        const p = before.then((prev) => {
          since.set(k, performance.now());
          return prev && prev !== 'end' ? this.prepare(k, prev.to, opts, signal) : prev === 'end' ? 'end' : null;
        });
        p.catch(() => undefined);
        pendings.set(k, p);
      }
    };
    this.replan = (from) => {
      for (const k of [...pendings.keys()]) {
        if (k >= from) {
          pendings.delete(k);
          since.delete(k);
        }
      }
      ensure(index + ahead);
    };
    // The run opens on the picture already on screen: its arrival, without the fade-in.
    const opening = await this.sceneOf(current, opts, signal, opts.crop);
    if (signal.aborted) return;
    ensure(ahead);
    await this.playStep({ depart: departAt(opts.motion, 0), from: current, to: current, sceneFrom: opening, sceneTo: opening, geo: geometryOf(opening, -1, -1), cellA: -1, cellB: -1, waveOrder: null, revealOrder: this.revealOrderFor(opening) }, opts, signal, true, -1);
    if (signal.aborted) return;
    for (;;) {
      ensure(index + ahead);
      this.warm(index, opts, signal);
      this.say({ waiting: true, phase: 'preparing' });
      const waitedFrom = performance.now();
      const step = await pendings.get(index)!;
      if (signal.aborted) return;
      // The measure: how long the step took to be ready, and whether its turn came before it was.
      const ready = performance.now();
      const waited = ready - waitedFrom;
      const prepMs = Math.round(ready - (since.get(index) ?? waitedFrom));
      since.delete(index);
      if (waited > 80) this.say({ prepMs, waits: this.status.waits + 1, waitMs: this.status.waitMs + Math.round(waited) });
      else this.say({ prepMs });
      if (step === 'end') {
        this.say({ playing: false, phase: 'done', note: index ? 'The chain ended at the last picked picture.' : 'Nothing queued: pick a picture, or let the chain draw the next ones.' });
        return;
      }
      if (!step) {
        this.say({ playing: false, error: 'No other picture to go to.' });
        return;
      }
      this.say({ waiting: false, stepIndex: index, current });
      await this.playStep(step, opts, signal, false, index);
      if (signal.aborted) return;
      pendings.delete(index);
      current = step.to;
      this.remember(current);
      index += 1;
      this.say({ current, done: index });
      if (once) {
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
    if (!opts.queue || ONCE.has(opts.mode as (typeof ONCE extends ReadonlySet<infer T> ? T : never))) return;
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
  private nextFor(depart: StepDeparture, index: number, fromIndex: number, sceneFrom: MosaicScene, opts: PlayerOptions): number | 'end' | null {
    const tiles = this.builder.tiles;
    const queued = opts.queue?.next(index);
    const picked = opts.queue?.picked?.(index) ?? false;
    // The queue's entry is the next picture — always when the person picked it, else when the aim is the chain's; a drawn entry yields to the best or a random cell.
    if (queued !== undefined && (picked || opts.motion.aim === 'queue' || depart === 'pull')) {
      const i = tiles.findIndex((t) => t.id === queued);
      if (i >= 0 && i !== fromIndex) return i;
    }
    if (opts.queue && !opts.queue.draw && queued === undefined) return 'end';
    let next: number;
    const history = this.historyIndexes();
    if (depart === 'pull') next = pickNextTarget(this.builder.labGrids(), tiles.length, fromIndex, { history, rnd: this.rnd });
    else if (opts.motion.aim === 'random') {
      const ids = sceneFrom.matching.ids;
      const cells: number[] = [];
      for (let c = 0; c < ids.length; c++) if (ids[c] >= 0 && ids[c] !== fromIndex && !history.includes(ids[c])) cells.push(c);
      if (!cells.length) return null;
      next = ids[cells[Math.floor(this.rnd() * cells.length)]];
    } else {
      const cell = pickCell(sceneFrom.matching, sceneFrom.shape.cols, sceneFrom.shape.rows, { target: fromIndex, history, rnd: this.rnd });
      if (cell < 0) return null;
      next = sceneFrom.matching.ids[cell];
    }
    if (next < 0) return null;
    opts.queue?.onDraw?.(index, tiles[next].id);
    return next;
  }

  /** The step that takes the chain from `from`: its next picture chosen, its two mosaics built, its cells found. */
  private async prepare(index: number, from: number, opts: PlayerOptions, signal: AbortSignal): Promise<Step | 'end' | null> {
    const tiles = this.builder.tiles;
    const fromIndex = tiles.findIndex((t) => t.id === from);
    if (fromIndex < 0 || tiles.length < 2) return null;
    const depart = departAt(opts.motion, index);
    const sceneFrom = await this.sceneOf(from, opts, signal);
    const nextIndex = this.nextFor(depart, index, fromIndex, sceneFrom, opts);
    if (nextIndex === 'end' || nextIndex === null) return nextIndex;
    const to = tiles[nextIndex].id;
    const sceneTo = await this.sceneOf(to, opts, signal);
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    // A dive enters the cell of the departed mosaic holding the next picture; a pull starts in the cell of the arrived one holding the departed picture.
    const cellA = depart === 'dive' || depart === 'wave' ? await this.builder.forceCell(sceneFrom, nextIndex, signal) : -1;
    const cellB = depart === 'pull' ? await this.builder.forceCell(sceneTo, fromIndex, signal) : -1;
    const waveOrder = depart === 'wave' ? waveOrderFrom(sceneFrom, cellA) : null;
    return {
      depart,
      from,
      to,
      sceneFrom,
      sceneTo,
      geo: geometryOf(sceneFrom, cellA, cellB, sceneTo),
      cellA,
      cellB,
      waveOrder,
      revealOrder: this.revealOrderFor(sceneTo),
    };
  }

  private revealOrderFor(scene: MosaicScene): Int32Array {
    return revealOrder(scene.shape.cols, scene.shape.rows, this.rnd);
  }

  private historyIndexes(): number[] {
    const tiles = this.builder.tiles;
    return this.history.map((id) => tiles.findIndex((t) => t.id === id)).filter((i) => i >= 0);
  }

  /** One step drawn frame by frame until its clock says it is over. */
  private playStep(step: Step, opts: PlayerOptions, signal: AbortSignal, opening: boolean, index: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const t0 = performance.now();
      const frame = (now: number) => {
        if (signal.aborted) return resolve();
        const f = stepFrameAt(opts.motion, opts.speed, step.depart, step.geo, now - t0, opening);
        this.live = { step, frame: f, index };
        if (f.phase !== this.status.phase) this.say({ phase: f.phase });
        // The arrived picture is on screen: the band's now, and the target a Stop writes.
        if (f.arrived && this.status.current !== step.to) this.say({ current: step.to });
        this.drawFrame(step, f, opts);
        if (f.done) return resolve();
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

  /**
   * A frame: the base mosaic through the camera, the aimed cell's true
   * content over its tile, the arrived mosaic's cells landing or the whole
   * of it crossing in, the base's photo over it (whole, or cell by cell).
   */
  private drawFrame(step: Step, f: StepFrame, opts: PlayerOptions): void {
    const c = this.context();
    if (!c) return;
    paintStepFrame(c.ctx, c.W, c.H, c.dpr, step, f, opts);
  }

  /**
   * A FILM of the motion for an export (M7): the opening and `steps` steps (one for a recipe that plays once), at
   * `size`, every frame a function of its time like the stage's. Steps are prepared ON DEMAND as the encoder asks for
   * frames in time order — the one being drawn and the next — and the ones behind are let go, so a 4K film never
   * holds its whole chain. Run on a player of its own: its own seed, picks and scenes; it reads the queue and never
   * writes it. A step that cannot be made (the queue out, drawing off) holds the last frame to the end.
   */
  film(opts: PlayerOptions, steps: number, size: StageSize, signal: AbortSignal): { seconds: number; draw: (t: number, ctx: CanvasRenderingContext2D) => Promise<void> } {
    this.size = size;
    this.rnd = mulberry32(opts.seed);
    this.history = [opts.from];
    this.scenes = new Map();
    this.held = size.stageW * size.stageH > 4_000_000 ? 3 : SCENES_HELD;
    const once = playsOnce(opts.mode);
    // The parts' lengths, known before anything is prepared: the opening, then each step's own departure.
    const lengths = filmParts(opts.motion, opts.speed, steps, once);
    const count = lengths.length - 1;
    const starts: number[] = [];
    let acc = 0;
    for (const l of lengths) {
      starts.push(acc);
      acc += l;
    }
    const total = acc;
    let opening: Promise<Step> | null = null;
    const prepared = new Map<number, Promise<Step | 'end' | null>>();
    const ensure = (k: number) => {
      for (let i = 0; i <= k && i < count; i++) {
        if (prepared.has(i)) continue;
        const before: Promise<Step | 'end' | null> = i === 0 ? Promise.resolve({ to: opts.from } as Step) : prepared.get(i - 1)!;
        const p = before.then(async (prev) => {
          if (!prev || prev === 'end') return prev;
          const step = await this.prepare(i, prev.to, opts, signal);
          if (step && step !== 'end') this.remember(step.to);
          return step;
        });
        p.catch(() => undefined);
        prepared.set(i, p);
      }
    };
    let last: { step: Step; f: StepFrame } | null = null;
    const draw = async (t: number, ctx: CanvasRenderingContext2D) => {
      const ms = Math.min(total, Math.max(0, t * 1000));
      let seg = 0;
      while (seg + 1 < starts.length && ms >= starts[seg + 1]) seg++;
      const local = ms - starts[seg];
      let step: Step | 'end' | null;
      if (seg === 0) {
        opening ??= this.sceneOf(opts.from, opts, signal, opts.crop).then((scene) => ({
          depart: departAt(opts.motion, 0),
          from: opts.from,
          to: opts.from,
          sceneFrom: scene,
          sceneTo: scene,
          geo: geometryOf(scene, -1, -1),
          cellA: -1,
          cellB: -1,
          waveOrder: null,
          revealOrder: this.revealOrderFor(scene),
        }));
        step = await opening;
        ensure(0);
      } else {
        const k = seg - 1;
        ensure(k + 1);
        step = await prepared.get(k)!;
        // The steps behind are let go: their scenes leave with them.
        for (const i of [...prepared.keys()]) if (i < k - 1) prepared.delete(i);
      }
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#100f0d';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      if (step && step !== 'end') {
        const f = stepFrameAt(opts.motion, opts.speed, step.depart, step.geo, local, seg === 0);
        last = { step, f };
      }
      if (last) paintStepFrame(ctx, size.stageW, size.stageH, size.dpr, last.step, last.f, opts);
    };
    return { seconds: total / 1000, draw };
  }
}

/**
 * One frame of a step into `ctx`, `W × H` logical pixels at `dpr`: the base mosaic through the camera, the aimed
 * cell's true content over its tile, the arrived mosaic's cells landing or the whole of it crossing in, the base's
 * photo over it (whole, or cell by cell). The stage and a film draw with it alike.
 */
function paintStepFrame(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, step: Step, f: StepFrame, opts: PlayerOptions): void {
  const base = f.base === 'from' ? step.sceneFrom : step.sceneTo;
  const other = f.base === 'from' ? step.sceneTo : step.sceneFrom;
  // The scene was built for its own size; the camera is in that space, scaled to the canvas.
  const kx = W / base.stageW;
  const ky = H / base.stageH;
  const cam = f.cam;
  ctx.setTransform(dpr * kx * cam.s, 0, 0, dpr * ky * cam.s, dpr * kx * (base.stageW / 2 - cam.vx * cam.s), dpr * ky * (base.stageH / 2 - cam.vy * cam.s));
  ctx.drawImage(base.canvas, 0, 0, base.stageW, base.stageH);
  const { cols, cw, ch } = base.shape;
  if (f.wave >= 0 && step.waveOrder) {
    // The arrived mosaic's cells, in order, over the departed one's.
    for (let q = 0; q < f.wave && q < step.waveOrder.length; q++) {
      const cell = step.waveOrder[q];
      const i = cell % cols;
      const j = (cell - i) / cols;
      ctx.drawImage(other.canvas, i * cw * other.dpr, j * ch * other.dpr, cw * other.dpr, ch * other.dpr, i * cw, j * ch, cw + 0.5, ch + 0.5);
    }
  }
  if (opts.grid && f.flipped < 0) {
    ctx.strokeStyle = 'rgba(244,240,231,0.35)';
    ctx.lineWidth = 1 / (dpr * cam.s);
    ctx.beginPath();
    for (let i = 1; i < cols; i++) {
      ctx.moveTo(i * cw, 0);
      ctx.lineTo(i * cw, base.stageH);
    }
    for (let j = 1; j < base.shape.rows; j++) {
      ctx.moveTo(0, j * ch);
      ctx.lineTo(base.stageW, j * ch);
    }
    ctx.stroke();
  }
  if (f.cellFill > 0) {
    // The aimed cell shows what it really is: the other side's photo (an arrival on the photo), else its mosaic.
    const cell = step.depart === 'pull' ? step.cellB : step.cellA;
    if (cell >= 0) {
      const r = cellRect(cell, cols, cw, ch);
      ctx.globalAlpha = f.cellFill;
      if (opts.motion.arrival === 'photo') {
        const src = coverSource(other.target.width, other.target.height, r.w, r.h);
        ctx.drawImage(other.target, src.x, src.y, src.w, src.h, r.x, r.y, r.w, r.h);
      } else ctx.drawImage(other.canvas, 0, 0, other.canvas.width, other.canvas.height, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
  }
  if (f.cross > 0) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = f.cross;
    ctx.drawImage(step.sceneTo.canvas, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  if (f.flipped >= 0 && step.revealOrder) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = cols * base.shape.rows;
    if (f.flipped >= count) drawTarget(ctx, base.target, W, H, dpr, 1, base.targetRect);
    else {
      const src = base.targetRect;
      for (let q = 0; q < f.flipped; q++) {
        const cell = step.revealOrder[q];
        const i = cell % cols;
        const j = (cell - i) / cols;
        const x = i * cw * kx;
        const y = j * ch * ky;
        const w = cw * kx;
        const h = ch * ky;
        ctx.drawImage(base.target, src.x + (x / W) * src.w, src.y + (y / H) * src.h, (w / W) * src.w, (h / H) * src.h, x, y, w + 0.5, h + 0.5);
      }
      if (opts.grid) drawGrid(ctx, base.shape, W, H, dpr);
    }
  }
  if (f.photo > 0) drawTarget(ctx, base.target, W, H, dpr, f.photo, base.targetRect);
}

/** The stage a step plays on, from the departed scene (and the arrived one's cell for a pull). */
function geometryOf(sceneFrom: MosaicScene, cellA: number, cellB: number, sceneTo?: MosaicScene): StepGeometry {
  const rectOf = (scene: MosaicScene, cell: number): CellRect | null => (cell >= 0 ? cellRect(cell, scene.shape.cols, scene.shape.cw, scene.shape.ch) : null);
  return {
    W: sceneFrom.stageW,
    H: sceneFrom.stageH,
    count: sceneFrom.shape.cols * sceneFrom.shape.rows,
    cellA: rectOf(sceneFrom, cellA),
    cellB: sceneTo ? rectOf(sceneTo, cellB) : null,
  };
}

/** The cells of `scene` by distance from `origin` (the centre when none): the order a wave lands in. */
function waveOrderFrom(scene: MosaicScene, origin: number): Int32Array {
  const { cols, rows } = scene.shape;
  const oc = origin >= 0 ? origin : Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  const oi = oc % cols;
  const oj = (oc - oi) / cols;
  const keyed: { c: number; d: number }[] = [];
  for (let c = 0; c < cols * rows; c++) {
    const i = c % cols;
    const j = (c - i) / cols;
    keyed.push({ c, d: Math.hypot(i - oi, j - oj) });
  }
  keyed.sort((a, b) => a.d - b.d || a.c - b.c);
  return Int32Array.from(keyed, (k) => k.c);
}

export { cellOf };
