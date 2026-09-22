/**
 * ONE place that knows what is running (`docs/progress-feedback.md` §3.1,
 * T1, 2026-09-21): a fetch, a decode, an export — anything that takes long
 * enough for a person to wonder whether the tab is still alive.
 *
 * The suite already REPORTED progress from a dozen modules, each drawn its
 * own way; this registry is where those reports meet, and two surfaces draw
 * it: `TaskEdge` (a hairline on a media's edge, for the tasks scoped to that
 * media) and `TaskPill` (a dot and a word in the masthead, the list in a
 * popover, with a Cancel where the work can really stop).
 *
 * Module state with a subscription, like the preset book and the session
 * cache — never a React context, so a task started by a hook survives the
 * screen that started it (his question 4: a roll export goes on while he
 * walks to the gallery, and the pill still says so).
 *
 * Rules (§3.2): a task is named after what a person ASKED for; a length
 * nobody knows is `null` and SWEEPS — a percentage nobody measured is a
 * fabrication; `cancel` is present only where stopping is real; and under
 * `SHOW_AFTER_MS` the surfaces draw nothing, so a fast fetch never flashes.
 */

export interface Task {
  id: string;
  /** What is happening, in the words a person would use: "Opening DSC00123.ARW". */
  label: string;
  /** 0..1 where it is known, null where it is not. */
  progress: number | null;
  /** A second line — "12 MB of 52", "3 of 8 pictures" — or null. */
  detail: string | null;
  /** What it belongs to, so a media's own edge draws only its own tasks. */
  scope: string | null;
  /** Present only where the work can really stop. Never drawn otherwise. */
  cancel: (() => void) | null;
  startedAt: number;
}

export interface TaskInit {
  label: string;
  scope?: string | null;
  progress?: number | null;
  detail?: string | null;
  cancel?: (() => void) | null;
}

export interface TaskPatch {
  label?: string;
  progress?: number | null;
  detail?: string | null;
}

export interface TaskHandle {
  id: string;
  /** Move the bar, change the words. Ignored once done. */
  update: (patch: TaskPatch) => void;
  /** The work ended, however it ended: the task leaves the list. */
  done: () => void;
}

/** How long a task must have run before a surface draws it. */
export const SHOW_AFTER_MS = 400;

const tasks = new Map<string, Task>();
let snapshot: readonly Task[] = [];
let version = 0;
let seq = 0;
const listeners = new Set<() => void>();

function changed(): void {
  snapshot = [...tasks.values()];
  version += 1;
  for (const fn of listeners) fn();
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Register a running task; the handle is how the work reports and ends it. */
export function startTask(init: TaskInit, now: number = Date.now()): TaskHandle {
  const id = `task-${++seq}`;
  tasks.set(id, {
    id,
    label: init.label,
    progress: init.progress == null ? null : clamp01(init.progress),
    detail: init.detail ?? null,
    scope: init.scope ?? null,
    cancel: init.cancel ?? null,
    startedAt: now,
  });
  changed();
  return {
    id,
    update: (patch) => {
      const cur = tasks.get(id);
      if (!cur) return;
      tasks.set(id, {
        ...cur,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress == null ? null : clamp01(patch.progress) } : {}),
        ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
      });
      changed();
    },
    done: () => {
      if (tasks.delete(id)) changed();
    },
  };
}

/** Every running task, oldest first — the same array until something changes. */
export function listTasks(): readonly Task[] {
  return snapshot;
}

/** The tasks scoped to one media. */
export function tasksFor(scope: string, all: readonly Task[] = snapshot): Task[] {
  return all.filter((t) => t.scope === scope);
}

/** Ask a task to stop, where it can. True when it could be asked. */
export function cancelTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task?.cancel) return false;
  task.cancel();
  return true;
}

export function tasksVersion(): number {
  return version;
}

export function subscribeTasks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** For a spec: nothing running. */
export function clearTasks(): void {
  if (tasks.size === 0) return;
  tasks.clear();
  changed();
}

// --- what a surface draws, pure ----------------------------------------------

/** The tasks old enough to be drawn — a bar that flashes on every fetch is noise. */
export function visibleTasks(all: readonly Task[], now: number, showAfter: number = SHOW_AFTER_MS): Task[] {
  return all.filter((t) => now - t.startedAt >= showAfter);
}

/** Milliseconds until the youngest hidden task becomes visible, or null when none is hidden. */
export function nextReveal(all: readonly Task[], now: number, showAfter: number = SHOW_AFTER_MS): number | null {
  let wait: number | null = null;
  for (const t of all) {
    const left = showAfter - (now - t.startedAt);
    if (left > 0 && (wait === null || left < wait)) wait = left;
  }
  return wait;
}

/**
 * One number for several tasks: the mean of what is measured, or null the
 * moment ANY of them has no length — a bar that is half determinate would be
 * claiming a whole nobody knows.
 */
export function overallProgress(all: readonly Task[]): number | null {
  if (all.length === 0) return null;
  let sum = 0;
  for (const t of all) {
    if (t.progress === null) return null;
    sum += t.progress;
  }
  return sum / all.length;
}

/** The pill's one word. */
export function pillWord(all: readonly Task[]): string {
  return all.length > 1 ? `${all.length} running` : 'Working';
}

/** The pill's sentence, for a screen reader and the popover's head. */
export function tasksSentence(all: readonly Task[]): string {
  if (all.length === 0) return 'Nothing running';
  if (all.length === 1) {
    const t = all[0];
    const pct = t.progress === null ? '' : ` · ${Math.round(t.progress * 100)} %`;
    return `${t.label}${pct}${t.detail ? ` · ${t.detail}` : ''}`;
  }
  return `${all.length} things running — ${all.map((t) => t.label).join(', ')}`;
}
