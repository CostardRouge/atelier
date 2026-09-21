import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { listTasks, nextReveal, subscribeTasks, tasksFor, tasksVersion, visibleTasks, type Task } from './tasks';

/**
 * The tasks a surface should draw right now: every running one, or those
 * scoped to one media — minus the ones under `SHOW_AFTER_MS`, which are
 * re-asked for the moment the youngest of them is old enough, so a surface
 * appears once and never flashes for a fetch that was over before it mattered.
 */
export function useTasks(scope?: string | null): Task[] {
  const version = useSyncExternalStore(subscribeTasks, tasksVersion);
  const [, wake] = useReducer((n: number) => n + 1, 0);
  const all = scope == null ? listTasks() : tasksFor(scope);
  const now = Date.now();
  useEffect(() => {
    const wait = nextReveal(all, Date.now());
    if (wait === null) return;
    const t = window.setTimeout(wake, wait + 5);
    return () => window.clearTimeout(t);
    // `version` is what changes `all`; the array itself is a fresh filter per scope.
  }, [version, scope, all]);
  return visibleTasks(all, now);
}
