import { useEffect, useRef } from 'react';
import { scheduleScore } from '../../shared/audio/render-bed';
import type { SoundEvent } from '../../shared/audio/sound-event';

/**
 * The opener's score, heard while the stage's transport plays.
 *
 * The same voices the export renders offline (`scheduleScore`), scheduled into
 * one live `AudioContext` — created on the first time the author turns the
 * sound on, which is the user gesture a browser insists on. It is OFF by
 * default: a panel that ticks while a slider is dragged is unusable, which is
 * why `p5-templates` keeps its UI sounds apart from its render bridge too.
 *
 * Every pass (a play, or a loop coming round) routes through a fresh gain node;
 * stopping mutes and drops that node, so sounds already scheduled into the
 * future fall silent instead of ticking on after a pause.
 */
export function useHookSound(
  score: readonly SoundEvent[],
  playing: boolean,
  time: number,
  enabled: boolean,
): void {
  const ctxRef = useRef<AudioContext | null>(null);
  const passRef = useRef<GainNode | null>(null);
  const lastTime = useRef(time);
  const running = playing && enabled && score.length > 0;

  const stop = () => {
    const pass = passRef.current;
    const ctx = ctxRef.current;
    if (pass && ctx) {
      pass.gain.setValueAtTime(0, ctx.currentTime);
      pass.disconnect();
    }
    passRef.current = null;
  };

  const start = (from: number) => {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (ctxRef.current ??= new AC());
    if (ctx.state === 'suspended') void ctx.resume();
    stop();
    const pass = ctx.createGain();
    pass.gain.value = 0.7;
    pass.connect(ctx.destination);
    passRef.current = pass;
    // A hair of lead time: a sound scheduled at `currentTime` exactly can be
    // dropped by a context that has already rendered that quantum.
    scheduleScore(ctx, pass, score, ctx.currentTime + 0.03, from);
  };

  // Start and stop with the transport and the toggle.
  useEffect(() => {
    if (running) start(time);
    else stop();
    // Only a change of state starts a pass; the clock's own ticks are handled
    // by the loop watcher below, and `time` here is read, not tracked.
  }, [running, score]);

  // A loop coming round: the clock jumped back, so the next pass begins.
  useEffect(() => {
    const previous = lastTime.current;
    lastTime.current = time;
    if (running && time < previous - 0.25) start(time);
  }, [time, running]);

  useEffect(
    () => () => {
      stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [],
  );
}
