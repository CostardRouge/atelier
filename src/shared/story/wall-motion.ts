/**
 * The LIVING WALL (strategy Phase 3, his « le mur d'image qui pourrait être
 * animé … coulissement … chaque rangée ou colonne … modes différents …
 * automatique ou intelligente »): motion as a LAYER over the wall's grid
 * (`wall-grid.ts`), which keeps everything it has — its cells, its bands by
 * stage or month, the pictures the rules chose. Each LANE (a row, or a
 * column) has a mode: still, slide (either way, at the wall's speed),
 * shuffle (two pictures swap places), flip (each picture turns to the next)
 * or breathe (a slow scale); neighbours set opposite give the « metro » look.
 * SMART motion (W2) keeps the camera's hero still while it lands, moves a
 * stage's band as one, slows while the voice speaks, steps on the music's
 * beats when it has them, and SETTLES on whole cells as the number arrives —
 * so the export ends on an aligned wall. With a QUEUE (W3) a lane brings in
 * pictures from off-frame as it turns, so a moving wall shows more of the
 * trip than a still one. Presets (W4) are starting points; a lane set by hand
 * makes the motion `custom`. Every position is a function of the scene's
 * clock: the export draws exactly what plays. (pure)
 */
import { rng } from './motion';
import type { StoryScript } from './story-script';

export type LaneMode = 'still' | 'slide' | 'shuffle' | 'flip' | 'breathe';
export const LANE_MODES: readonly LaneMode[] = ['still', 'slide', 'shuffle', 'flip', 'breathe'];
/** Along the lane: +1 right (rows) or down (columns), −1 left or up. */
export type LaneDir = 1 | -1;
export interface Lane {
  mode: LaneMode;
  dir: LaneDir;
}

export type WallAxis = 'rows' | 'columns';
export type WallMotionPreset = 'none' | 'marquee' | 'metro' | 'waterfall' | 'shuffle' | 'flipboard' | 'calm';

export interface WallMotion {
  preset: WallMotionPreset | 'custom';
  axis: WallAxis;
  /** The lanes' settings, from the first lane (top row, left column), repeated past the last. */
  lanes: Lane[];
  /** 0.25 to 3: a slide at 1× moves `SLIDE_CELLS` cells a second. */
  speed: number;
  /** W2: hero still while it lands, bands as one, slower under the voice, beats, a settled end. */
  smart: boolean;
  /** W3: a turning lane brings in pictures from off-frame. */
  queue: boolean;
}

export const SLIDE_CELLS = 0.45;
/** How many times the wall's places a queue counts: a moving wall shows up to this many pictures a place. */
export const QUEUE_LAPS = 3;
export const SPEED_LIMITS = [0.25, 3] as const;

const STILL: Lane = { mode: 'still', dir: 1 };
const L = (mode: LaneMode, dir: LaneDir = 1): Lane => ({ mode, dir });

export const WALL_MOTION_PRESETS: Record<WallMotionPreset, Omit<WallMotion, 'preset'>> = {
  none: { axis: 'rows', lanes: [STILL], speed: 1, smart: true, queue: false },
  marquee: { axis: 'rows', lanes: [L('slide', -1)], speed: 1, smart: true, queue: true },
  metro: { axis: 'rows', lanes: [L('slide', -1), L('slide', 1)], speed: 1.1, smart: true, queue: true },
  waterfall: { axis: 'columns', lanes: [L('slide', 1)], speed: 0.8, smart: true, queue: true },
  shuffle: { axis: 'rows', lanes: [L('shuffle')], speed: 1, smart: true, queue: false },
  flipboard: { axis: 'rows', lanes: [L('flip')], speed: 1, smart: true, queue: true },
  calm: { axis: 'rows', lanes: [L('slide', 1), L('breathe'), L('slide', -1)], speed: 0.35, smart: true, queue: false },
};
export const WALL_MOTION_LABEL: Record<WallMotionPreset | 'custom', string> = {
  none: 'Still',
  marquee: 'Marquee',
  metro: 'Metro',
  waterfall: 'Waterfall',
  shuffle: 'Shuffle board',
  flipboard: 'Flip board',
  calm: 'Calm',
  custom: 'Your own',
};
export const LANE_GLYPH: Record<LaneMode, (dir: LaneDir, axis: WallAxis) => string> = {
  still: () => '·',
  slide: (d, a) => (a === 'rows' ? (d < 0 ? '←' : '→') : d < 0 ? '↑' : '↓'),
  shuffle: () => '⇄',
  flip: () => '↻',
  breathe: () => '◦',
};

/** A preset's motion. (pure) */
export const presetMotion = (p: WallMotionPreset): WallMotion => ({ preset: p, ...WALL_MOTION_PRESETS[p], lanes: WALL_MOTION_PRESETS[p].lanes.map((l) => ({ ...l })) });

/** The motion a series or post asks for, its absent fields from its preset — none = the wall as before. (pure) */
export function wallMotionOf(given?: Partial<WallMotion> | null): WallMotion {
  const base = presetMotion(given?.preset && given.preset !== 'custom' ? given.preset : 'none');
  return { ...base, ...(given ?? {}), lanes: given?.lanes?.length ? given.lanes : base.lanes };
}

/** Whether a motion moves anything at all. (pure) */
export const moves = (m: WallMotion): boolean => m.lanes.some((l) => l.mode !== 'still');

/** A script's wall motion, kept field by field when well formed. (pure) */
export function readWallMotion(raw: unknown): Partial<WallMotion> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<WallMotion> = {};
  if (typeof r.preset === 'string' && (r.preset === 'custom' || r.preset in WALL_MOTION_PRESETS)) out.preset = r.preset as WallMotion['preset'];
  if (r.axis === 'rows' || r.axis === 'columns') out.axis = r.axis;
  if (Array.isArray(r.lanes)) {
    const lanes = r.lanes
      .slice(0, 40)
      .flatMap((l): Lane[] =>
        typeof l === 'object' && l !== null && (LANE_MODES as readonly string[]).includes((l as Lane).mode)
          ? [{ mode: (l as Lane).mode, dir: (l as Lane).dir === -1 ? -1 : 1 }]
          : [],
      );
    if (lanes.length) out.lanes = lanes;
  }
  if (typeof r.speed === 'number' && Number.isFinite(r.speed)) out.speed = Math.min(SPEED_LIMITS[1], Math.max(SPEED_LIMITS[0], r.speed));
  if (typeof r.smart === 'boolean') out.smart = r.smart;
  if (typeof r.queue === 'boolean') out.queue = r.queue;
  return Object.keys(out).length ? out : undefined;
}

/** How many pictures counting keeps for a wall of `cells` places under this motion (W3). (pure) */
export function wallCapacity(cells: number, motion: Partial<WallMotion> | null | undefined, max: number): number {
  const m = wallMotionOf(motion);
  return Math.min(max, m.queue && moves(m) ? cells * QUEUE_LAPS : cells);
}

/** A lane's setting: the series' list repeated past its end. (pure) */
export const laneOf = (m: WallMotion, lane: number): Lane => m.lanes[((lane % m.lanes.length) + m.lanes.length) % m.lanes.length] ?? STILL;

// ---- the clock -----------------------------------------------------------------------------------------

/** What the post knows besides the wall: when the voice speaks and the music's beats, on the scene's clock. */
export interface WallCues {
  speech?: readonly (readonly [number, number])[];
  beats?: readonly number[];
}

/** When smart motion starts (the camera has pulled back off the hero) and settles (the number arrives), scene seconds. */
export const SMART_FROM = 1.0;
export const SETTLE_AT = 1.9;
export const SETTLE_FOR = 0.6;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOut = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/** How fast the wall moves at `t`, 0 to 1, as smart motion rules it (the voice slows it to a third). (pure) */
export function smartRate(t: number, cues: WallCues): number {
  let r = smooth(SMART_FROM - 0.4, SMART_FROM + 0.3, t);
  for (const [a, b] of cues.speech ?? []) r *= 1 - 0.65 * smooth(a - 0.3, a, t) * (1 - smooth(b, b + 0.3, t));
  return r;
}

/**
 * How many cells a sliding lane has travelled at `t` (scene seconds), its
 * sign the lane's way. Plain: speed × time. Smart: integrated over the rate
 * (still on the hero, slower under the voice), one cell a beat where the
 * music has beats, then eased onto the next whole cell from `SETTLE_AT`. (pure)
 */
export function travelled(t: number, m: WallMotion, dir: LaneDir, cues: WallCues = {}, step = 1 / 60): number {
  const v = SLIDE_CELLS * m.speed;
  if (!m.smart) return dir * v * Math.max(0, t);
  const beats = (cues.beats ?? []).filter((b) => b >= SMART_FROM && b < SETTLE_AT);
  const at = (x: number): number => {
    if (beats.length >= 2) {
      // A cell a beat (two above 1.5×, one every other beat under 0.6×), each step eased over a third of a second.
      const per = m.speed >= 1.5 ? 2 : 1;
      const kept = m.speed < 0.6 ? beats.filter((_, i) => i % 2 === 0) : beats;
      return kept.reduce((s, b) => s + per * easeOut((x - b) / 0.33), 0);
    }
    let s = 0;
    for (let y = 0; y < Math.min(x, SETTLE_AT); y += step) s += v * smartRate(y, cues) * Math.min(step, x - y);
    return s;
  };
  const free = at(Math.min(t, SETTLE_AT));
  if (t <= SETTLE_AT) return dir * free;
  // Land on the next whole cell, the way it was going.
  const goal = Math.ceil(free - 1e-6);
  return dir * (free + (goal - free) * easeOut((t - SETTLE_AT) / SETTLE_FOR));
}

/** One picture's place drawn at `t`: moved, scaled about its centre, and which turn of the queue it shows. */
export interface MotionDraw {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** How many times its lane has brought it round (slide) or turned it (flip): the queue's offset. */
  lap: number;
  /** Under a shuffle, the place whose picture it shows (an index into the places); absent = its own. */
  shows?: number;
}

/** A place as the motion sees it: its cell, its span, its position along its lane. */
export interface MotionPlace {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
  span: number;
  band?: number;
  /** The camera's hero: the picture the wall opens on. */
  centre?: boolean;
}

/** The grid's extent: where it starts and how long a lane runs, in pixels. */
export interface MotionGrid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

/**
 * The lanes that move as ONE: a big picture's two lanes, and under smart
 * motion a band's lanes (a stage, a month) — each lane mapped to the first of
 * its group, whose setting the group follows. (pure)
 */
export function laneLeaders(places: readonly MotionPlace[], axis: WallAxis, lanes: number, smart: boolean): Int16Array {
  const lead = new Int16Array(lanes).map((_, i) => i);
  const find = (i: number): number => (lead[i] === i ? i : (lead[i] = find(lead[i])));
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) lead[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (const p of places) {
    const lane = axis === 'rows' ? p.row : p.col;
    if (p.span > 1 && lane + 1 < lanes) join(lane, lane + 1);
  }
  if (smart && axis === 'rows') {
    const firstOfBand = new Map<number, number>();
    for (const p of places) {
      if (p.band === undefined) continue;
      const f = firstOfBand.get(p.band);
      if (f === undefined) firstOfBand.set(p.band, p.row);
      else join(f, p.row);
    }
  }
  for (let i = 0; i < lanes; i++) lead[i] = find(i);
  return lead;
}

/** A lane's swaps up to `t` (shuffle): which place shows which picture, and the swap under way. */
function shuffled(n: number, lane: number, t: number, period: number, from: number, until: number): { perm: number[]; moving: { a: number; b: number; u: number } | null } {
  const perm = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return { perm, moving: null };
  const phase = (lane * 0.37) % 1;
  let moving: { a: number; b: number; u: number } | null = null;
  for (let k = 0; ; k++) {
    const at = from + (k + phase) * period;
    if (at > Math.min(t, until)) break;
    const draw = rng(1000 + lane * 97 + k);
    const a = Math.floor(draw() * n);
    const b = (a + 1 + Math.floor(draw() * (n - 1))) % n;
    const u = (t - at) / 0.5;
    if (u < 1) {
      moving = { a, b, u };
      break;
    }
    [perm[a], perm[b]] = [perm[b], perm[a]];
  }
  return { perm, moving };
}

/**
 * Every place's draws at scene time `t` under the motion — one, or two when
 * a sliding lane wraps it across the grid's seam (both halves drawn, the
 * seam is off the frame). `places` are the wall's places in the order the
 * wall draws them. (pure)
 */
export function motionDraws(places: readonly MotionPlace[], grid: MotionGrid, mRaw: WallMotion, t: number, cues: WallCues = {}): MotionDraw[][] {
  const m = mRaw;
  const rows = m.axis === 'rows';
  const lanes = rows ? grid.rows : grid.cols;
  const lead = laneLeaders(places, m.axis, lanes, m.smart);
  const laneLen = rows ? grid.cols * grid.cellW : grid.rows * grid.cellH;
  const cell = rows ? grid.cellW : grid.cellH;
  const period = 1.6 / m.speed;
  const from = m.smart ? SMART_FROM : 0;
  const until = m.smart ? SETTLE_AT : Infinity;
  // The places of each lane in order along it — what a shuffle swaps and a flip staggers over.
  const byLane = new Map<number, number[]>();
  places.forEach((p, i) => {
    if (p.span > 1) return;
    const l = rows ? p.row : p.col;
    const list = byLane.get(l) ?? [];
    list.push(i);
    byLane.set(l, list);
  });
  for (const list of byLane.values()) list.sort((a, b) => (rows ? places[a].x - places[b].x : places[a].y - places[b].y));
  const shuffles = new Map<number, ReturnType<typeof shuffled>>();
  const slides = new Map<number, number>();
  // Smart: the hero's lane is the wall's spine — still while the camera lands on it and after.
  const hero = places.find((p) => p.centre);
  const heroLead = m.smart && hero ? lead[rows ? hero.row : hero.col] : -1;

  return places.map((p, i): MotionDraw[] => {
    const laneIdx = rows ? p.row : p.col;
    const leader = lead[laneIdx] ?? laneIdx;
    const lane = laneOf(m, leader);
    const at = (dx: number, dy: number, lap = 0, sx = 1, sy = 1): MotionDraw => ({ dx, dy, sx, sy, lap });
    if (lane.mode === 'still' || leader === heroLead) return [at(0, 0)];
    if (lane.mode === 'breathe') {
      const k = 1 + 0.035 * Math.sin(2 * Math.PI * t * 0.25 * m.speed + leader * 0.9) * (m.smart ? smartRate(t, cues) : 1);
      return [at(0, 0, 0, k, k)];
    }
    if (lane.mode === 'slide') {
      let cells = slides.get(leader);
      if (cells === undefined) slides.set(leader, (cells = travelled(t, m, lane.dir, cues)));
      const along = rows ? p.x - grid.x0 : p.y - grid.y0;
      const size = rows ? p.w : p.h;
      const moved = along + cells * cell;
      const lap = Math.floor(moved / laneLen);
      const pos = moved - lap * laneLen;
      const d = pos - along;
      const out = [rows ? at(d, 0, lap) : at(0, d, lap)];
      // Past the seam: the part still showing at the start of the lane.
      if (pos + size > laneLen) out.push(rows ? at(d - laneLen, 0, lap + 1) : at(0, d - laneLen, lap + 1));
      return out;
    }
    const list = byLane.get(laneIdx);
    const k = list ? list.indexOf(i) : -1;
    if (k < 0) return [at(0, 0)];
    if (lane.mode === 'shuffle') {
      let s = shuffles.get(laneIdx);
      if (!s) shuffles.set(laneIdx, (s = shuffled(list!.length, laneIdx, t, period, from, until)));
      // The place shows the picture its permutation names; during a swap the two pictures cross over.
      const shows = list![s.perm[k]];
      let dx = 0;
      let dy = 0;
      if (s.moving && (k === s.moving.a || k === s.moving.b)) {
        const other = places[list![k === s.moving.a ? s.moving.b : s.moving.a]];
        const e = smooth(0, 1, s.moving.u);
        dx = (other.x - p.x) * e;
        dy = (other.y - p.y) * e;
      }
      return [{ dx, dy, sx: 1, sy: 1, lap: 0, ...(shows !== i ? { shows } : {}) }];
    }
    // flip: each picture turns over to the next, one after the other along the lane.
    const offset = from + 0.08 * k + ((laneIdx * 0.29) % 1) * period;
    const last = until === Infinity ? Infinity : Math.floor((until - offset) / period);
    const elapsed = t - offset;
    if (elapsed < 0 || last < 0) return [at(0, 0)];
    const n = Math.min(last, Math.floor(elapsed / period));
    const u = (elapsed - n * period) / 0.45;
    const turning = u < 1;
    const flip = turning ? Math.abs(Math.cos(Math.PI * u)) : 1;
    const shown = turning && u < 0.5 ? n : n + 1;
    return [rows ? at(0, 0, shown, Math.max(0.02, flip), 1) : at(0, 0, shown, 1, Math.max(0.02, flip))];
  });
}

// ---- the script ---------------------------------------------------------------------------------------

/** The motion a post plays: the series', this post's over it. (pure) */
export function motionIn(script: StoryScript | null, postId: string): WallMotion {
  return wallMotionOf({ ...(script?.look?.wallMotion ?? {}), ...(script?.posts[postId]?.wallMotion ?? {}) });
}

/**
 * The script with the wall's motion set for every post (`series`) or this
 * post alone; null takes that level's away (a post then follows the series,
 * the series is still again). (pure)
 */
export function withWallMotion(script: StoryScript, where: 'series' | 'post', postId: string, motion: Partial<WallMotion> | null): StoryScript {
  if (where === 'series') {
    const look = { ...(script.look ?? {}) };
    if (motion) look.wallMotion = motion;
    else delete look.wallMotion;
    const next: StoryScript = { ...script, look };
    if (!Object.keys(look).length) delete next.look;
    return next;
  }
  const post = { ...(script.posts[postId] ?? {}) };
  if (motion) post.wallMotion = motion;
  else delete post.wallMotion;
  return { ...script, posts: { ...script.posts, [postId]: post } };
}

/** The next mode a lane chip takes on a click: still → slide back → slide on → shuffle → flip → breathe → still. (pure) */
export function nextLane(l: Lane): Lane {
  const order: Lane[] = [L('still'), L('slide', -1), L('slide', 1), L('shuffle'), L('flip'), L('breathe')];
  const i = order.findIndex((o) => o.mode === l.mode && (o.mode !== 'slide' || o.dir === l.dir));
  return { ...order[(i + 1) % order.length] };
}

/** `count` lanes spelt out from the motion's repeating list — what editing one lane starts from. (pure) */
export const spelled = (m: WallMotion, count: number): Lane[] => Array.from({ length: count }, (_, i) => ({ ...laneOf(m, i) }));
