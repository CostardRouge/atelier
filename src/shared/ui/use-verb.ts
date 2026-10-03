import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startTask } from '../tasks/tasks';
import {
  VERB_DONE_MS,
  VERB_SETTLE_MAX_MS,
  outcomeOf,
  settled,
  type VerbOutcome,
  type VerbPhase,
  type VerbReturn,
} from './verb';

/** A verb as its button needs it (`verb.ts`). */
export interface Verb {
  phase: VerbPhase;
  /**
   * Runs the verb: the button goes down and stays down while `work` runs and
   * the picture catches up, then says ✓ or –. Ignored while it already runs.
   * `echo` names the media the work changes in front of the person (a task
   * scope): its edge draws a hairline from the press to the end (`Task.echo`).
   */
  run: (work: () => VerbReturn | Promise<VerbReturn>, options?: VerbRunOptions) => void;
  /** The verb was refused before it ran (a greyed glyph tapped): – and why. */
  refuse: (why: string) => void;
}

export interface VerbRunOptions {
  /** The task scope of the media this verb re-renders — its edge echoes the work at once. */
  echo?: string | null;
}

/** One frame painted: the state set before it is on screen. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/**
 * Until the thread goes quiet (`settled`): the work's re-render, the deferred
 * bake behind it and the stage's repaint are long frames; a few short ones in
 * a row mean the picture has caught up. Never longer than the ceiling, and a
 * hidden tab (no frames at all) ends on the ceiling's timer.
 */
function untilQuiet(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(ceiling);
      resolve();
    };
    const ceiling = window.setTimeout(finish, VERB_SETTLE_MAX_MS);
    const gaps: number[] = [];
    let last = -1;
    const tick = (t: number) => {
      if (done) return;
      if (last >= 0) gaps.push(t - last);
      last = t;
      if (settled(gaps)) finish();
      else requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame !== 'function') finish();
    else requestAnimationFrame(tick);
  });
}

function wordOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'that did not work';
}

/**
 * A verb's life (`verb.ts`). `onOutcome` hears how each run went — the word
 * a host draws beside the verbs (C3). The phase is local state, so a verb
 * started by a keyboard shortcut lights the same glyph a press would.
 */
export function useVerb(onOutcome?: (outcome: VerbOutcome) => void): Verb {
  const [phase, setPhase] = useState<VerbPhase>('idle');
  const running = useRef(false);
  const alive = useRef(true);
  const timer = useRef(0);
  const told = useRef(onOutcome);
  told.current = onOutcome;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const end = useCallback((outcome: VerbOutcome) => {
    running.current = false;
    if (!alive.current) return;
    window.clearTimeout(timer.current);
    setPhase(outcome.ok ? 'done' : 'failed');
    told.current?.(outcome);
    timer.current = window.setTimeout(() => {
      if (alive.current) setPhase('idle');
    }, VERB_DONE_MS);
  }, []);

  const run = useCallback(
    (work: () => VerbReturn | Promise<VerbReturn>, options?: VerbRunOptions) => {
      if (running.current) return;
      running.current = true;
      window.clearTimeout(timer.current);
      setPhase('working');
      // The echo starts with the press: the media in front of the person says
      // it is being worked on before the work has even begun (C4).
      const echo = options?.echo ? startTask({ label: 'Updating the picture', scope: options.echo, echo: true }) : null;
      void (async () => {
        let outcome: VerbOutcome;
        try {
          await afterPaint();
          outcome = outcomeOf(await work());
          await untilQuiet();
        } catch (error) {
          outcome = { ok: false, word: wordOf(error) };
        }
        echo?.done();
        end(outcome);
      })();
    },
    [end],
  );

  const refuse = useCallback(
    (why: string) => {
      if (running.current) return;
      end({ ok: false, word: why });
    },
    [end],
  );

  return useMemo(() => ({ phase, run, refuse }), [phase, run, refuse]);
}
