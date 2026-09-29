/**
 * Where an export RUN stands, unit by unit — what the Deliver bar draws as a
 * segment per unit and a tool's own strip as a mark per cell. A unit is what
 * one file comes from: a picture of a Develop roll, a slide of a Trips piece,
 * a variant of a Studio clip (2026-09-28, his pick V1 + V4 in Develop; carried
 * to Trips and the Studio on 2026-09-29).
 *
 * Each unit names its own PHASES — a still is rendered and written, a clip
 * fetched, encoded and written — and the step in hand may carry a measured
 * RATIO (an encode knows how far it is; a decode does not). Nothing is
 * estimated but the time left, measured from the units this run already
 * finished and said as "about".
 *
 * Pure and DOM-free; each tool's export hook drives it.
 */

/** One unit of a run. `failed` is a unit that did not leave — skipped, refused or broken. */
export type RunUnitState = 'queued' | 'active' | 'done' | 'failed';

/** A stage of a unit, in the one word a person reads. */
export interface RunPhase {
  id: string;
  label: string;
}

export interface RunUnit {
  id: string;
  /** The unit's name as the tool says it — `DJI_0101.JPG`, `Slide 2 · DJI_0415.MP4`. */
  name: string;
  /** Its stages, in order; the first is where it starts. */
  phases: readonly RunPhase[];
}

export interface RunProgress {
  /** The run's units, in the order they leave. */
  ids: readonly string[];
  names: readonly string[];
  /** Each unit's own stages, parallel to `ids`. */
  phases: readonly (readonly RunPhase[])[];
  /** Each unit's state, parallel to `ids`. */
  states: readonly RunUnitState[];
  /** The unit in hand; -1 before the first. */
  index: number;
  /** The stage of the unit in hand, by id. */
  phase: string | null;
  /** The step in words, as the run says it — `Fetching DJI_0101.DNG · 74 MB`. */
  step: string | null;
  /** How far the step in hand is, 0–1, where it is MEASURED; null where nothing knows. */
  ratio: number | null;
  /** When the run started — after the folder was chosen, so the picker's wait is not counted. */
  startedAt: number;
  /** When the last unit finished, or null before the first. */
  lastFinishedAt: number | null;
  /** A Cancel was asked: the run stops at the next unit boundary. */
  cancelling: boolean;
}

export function startRun(units: readonly RunUnit[], now: number): RunProgress {
  return {
    ids: units.map((u) => u.id),
    names: units.map((u) => u.name),
    phases: units.map((u) => u.phases),
    states: units.map(() => 'queued'),
    index: -1,
    phase: null,
    step: null,
    ratio: null,
    startedAt: now,
    lastFinishedAt: null,
    cancelling: false,
  };
}

function withState(states: readonly RunUnitState[], index: number, state: RunUnitState): RunUnitState[] {
  const next = [...states];
  if (index >= 0 && index < next.length) next[index] = state;
  return next;
}

/** The run takes the unit at `index` in hand, at its first stage. */
export function enterUnit(p: RunProgress, index: number): RunProgress {
  return { ...p, index, states: withState(p.states, index, 'active'), phase: p.phases[index]?.[0]?.id ?? null, step: null, ratio: null };
}

/** The unit in hand moved to a stage, or further through one (`ratio`, when measured). */
export function atStep(p: RunProgress, phase: string, step: string, ratio: number | null = null): RunProgress {
  return { ...p, phase, step, ratio: ratio === null ? null : Math.min(1, Math.max(0, ratio)) };
}

/** The unit at `index` is finished: it left (`ok`) or it did not. */
export function finishUnit(p: RunProgress, index: number, ok: boolean, now: number): RunProgress {
  return { ...p, states: withState(p.states, index, ok ? 'done' : 'failed'), phase: null, step: null, ratio: null, lastFinishedAt: now };
}

export function cancelRun(p: RunProgress): RunProgress {
  return p.cancelling ? p : { ...p, cancelling: true };
}

export interface RunCounts {
  total: number;
  done: number;
  failed: number;
  /** Done or failed: what the time left is measured over. */
  finished: number;
}

export function runCounts(p: RunProgress): RunCounts {
  let done = 0;
  let failed = 0;
  for (const s of p.states) {
    if (s === 'done') done += 1;
    else if (s === 'failed') failed += 1;
  }
  return { total: p.states.length, done, failed, finished: done + failed };
}

/** The state of one unit in the run, or null when it is not in it. */
export function runStateOf(p: RunProgress | null, id: string): RunUnitState | null {
  if (!p) return null;
  const i = p.ids.indexOf(id);
  return i < 0 ? null : p.states[i];
}

/** Where the unit in hand is among its own stages, 0-based; -1 outside one. */
export function phaseIndex(p: RunProgress): number {
  if (p.index < 0 || p.phase === null) return -1;
  return (p.phases[p.index] ?? []).findIndex((ph) => ph.id === p.phase);
}

/**
 * How far the whole run is, 0–1, counted in STAGES: every finished unit is
 * one, the unit in hand its stages passed plus the measured part of the one
 * in hand. Never a time estimate — what a header's fill can say honestly.
 */
export function runFraction(p: RunProgress): number {
  const { total, finished } = runCounts(p);
  if (total === 0) return 0;
  let inHand = 0;
  if (p.index >= 0 && p.states[p.index] === 'active') {
    const stages = p.phases[p.index]?.length || 1;
    inHand = (Math.max(0, phaseIndex(p)) + (p.ratio ?? 0)) / stages;
  }
  return Math.min(1, (finished + inHand) / total);
}

/**
 * Seconds left, MEASURED: the mean time of the units this run finished, times
 * those still to finish, less what the one in hand has already taken. Null
 * until one unit has finished — before that it would be a guess.
 */
export function timeLeft(p: RunProgress, now: number): number | null {
  const { total, finished } = runCounts(p);
  if (finished === 0 || p.lastFinishedAt === null || finished >= total) return null;
  const mean = (p.lastFinishedAt - p.startedAt) / finished;
  const onCurrent = Math.max(0, now - p.lastFinishedAt);
  return Math.max(0, (mean * (total - finished) - onCurrent) / 1000);
}

/** `about 40 s left`, `about 3 min left` — or null when nothing is measured yet. */
export function describeTimeLeft(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 5) return 'almost done';
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5} s left`;
  return `about ${Math.round(seconds / 60)} min left`;
}
