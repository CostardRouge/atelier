import { useEffect, useState } from 'react';
import { badgeSettleSeconds, type BadgePieceStyles } from '../../shared/roadtrip/badge-layout';
import { describeKeyTarget, targetOwnsSpace } from '../../shared/media/transport-keys';

export interface BadgeClock {
  /** Where the badge's own animations are up to, in seconds. */
  time: number;
  setTime: (seconds: number) => void;
  playing: boolean;
  setPlaying: (next: boolean | ((p: boolean) => boolean)) => void;
  /** The transport's span — the hook's life when anything exits, else settle + a beat. */
  loopSeconds: number;
  /** Whether any piece is animated at all; the transport only shows then. */
  animated: boolean;
}

/**
 * The badge's own clock — what plays on the stage is the badge's entrance
 * and exit, not a video element, so `use-video-transport` cannot serve here.
 *
 * A still of an animated badge shows it settled, never caught mid-slide.
 * With an exit the loop IS the hook: you have to watch it leave. Space is the
 * suite's transport key, bound on `window` so it works wherever the pointer
 * is; the guard is the shared one, so a space typed into a field stays one.
 */
export function useBadgeClock(
  styles: BadgePieceStyles,
  durationSeconds: number,
  enabled: boolean,
): BadgeClock {
  const settle = badgeSettleSeconds(styles);
  const list = Object.values(styles);
  const animated = list.some((s) => s?.animation);
  const exits = list.some((s) => s?.animation?.out);
  const loopSeconds = exits ? durationSeconds : Math.max(settle + 1.5, 3);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!animated) setTime(0);
    else if (!playing) setTime(settle);
  }, [animated, settle, playing]);

  useEffect(() => {
    if (!enabled || !animated) return;
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (targetOwnsSpace(describeKeyTarget(e.target))) return;
      e.preventDefault(); // Space scrolls the page otherwise.
      setPlaying((p) => !p);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, animated]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let started: number | null = null;
    const tick = (now: number) => {
      started ??= now;
      setTime(((now - started) / 1000) % loopSeconds);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loopSeconds]);

  return { time, setTime, playing, setPlaying, loopSeconds, animated };
}
