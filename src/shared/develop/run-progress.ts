/**
 * Where a roll's export RUN stands, picture by picture — what the Deliver bar
 * draws as a segment per picture and the filmstrip as a mark per cell
 * (2026-09-28, his pick V1 + V4 of the Export-tab lab).
 *
 * The run already said its step in a sentence and gave the task pill a count;
 * what nobody could see was WHICH pictures were done, which one was in hand
 * and at which stage of it. This is that state, and nothing is estimated in
 * it but the time left, which is measured from the pictures this run has
 * already finished and said as "about".
 *
 * Pure and DOM-free; the export hook (`use-roll-export.ts`) drives it.
 */

/** One picture of a run. `failed` is a picture that did not leave — skipped, refused or broken. */
export type RunPictureState = 'queued' | 'active' | 'done' | 'failed';

/** The stage of the picture in hand, in the three words a person reads. */
export type RunPhase = 'fetch' | 'develop' | 'write';

/** Getting the bytes (and measuring them), developing them, writing the file. */
export const RUN_PHASES: readonly { id: RunPhase; label: string }[] = [
  { id: 'fetch', label: 'Fetch' },
  { id: 'develop', label: 'Develop' },
  { id: 'write', label: 'Write' },
];

export interface RunProgress {
  /** The run's pictures, in the order they leave. */
  ids: readonly string[];
  /** Each picture's name as the strip says it, parallel to `ids`. */
  names: readonly string[];
  /** Each picture's state, parallel to `ids`. */
  states: readonly RunPictureState[];
  /** The picture in hand; -1 before the first. */
  index: number;
  phase: RunPhase | null;
  /** The step in words, as the run says it — `Fetching DJI_0101.DNG · 74 MB`. */
  step: string | null;
  /** When the run started — after the folder was chosen, so the picker's wait is not counted. */
  startedAt: number;
  /** When the last picture finished, or null before the first. */
  lastFinishedAt: number | null;
  /** A Cancel was asked: the run stops at the next picture boundary. */
  cancelling: boolean;
}

export function startRun(pictures: readonly { id: string; name: string }[], now: number): RunProgress {
  return {
    ids: pictures.map((p) => p.id),
    names: pictures.map((p) => p.name),
    states: pictures.map(() => 'queued'),
    index: -1,
    phase: null,
    step: null,
    startedAt: now,
    lastFinishedAt: null,
    cancelling: false,
  };
}

function withState(states: readonly RunPictureState[], index: number, state: RunPictureState): RunPictureState[] {
  const next = [...states];
  if (index >= 0 && index < next.length) next[index] = state;
  return next;
}

/** The run takes the picture at `index` in hand. */
export function enterPicture(p: RunProgress, index: number): RunProgress {
  return { ...p, index, states: withState(p.states, index, 'active'), phase: 'fetch', step: null };
}

/** The picture in hand moved to another step. */
export function atStep(p: RunProgress, phase: RunPhase, step: string): RunProgress {
  return { ...p, phase, step };
}

/** The picture at `index` is finished: it left (`ok`) or it did not. */
export function finishPicture(p: RunProgress, index: number, ok: boolean, now: number): RunProgress {
  return { ...p, states: withState(p.states, index, ok ? 'done' : 'failed'), phase: null, step: null, lastFinishedAt: now };
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

/** The state of one picture in the run, or null when it is not in it. */
export function runStateOf(p: RunProgress | null, id: string): RunPictureState | null {
  if (!p) return null;
  const i = p.ids.indexOf(id);
  return i < 0 ? null : p.states[i];
}

/**
 * Seconds left, MEASURED: the mean time of the pictures this run finished,
 * times those still to finish, less what the one in hand has already taken.
 * Null until one picture has finished — before that it would be a guess.
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
