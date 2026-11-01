import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { scheduleVoice } from '../../shared/audio/voices';
import type { SoundEvent } from '../../shared/audio/sound-event';
import { PlayClock } from '../../shared/media/play-clock';

/** A recorded sound on the post's clock: a file's buffer, when it starts, its level. */
export interface TimedBuffer {
  buffer: AudioBuffer;
  at: number;
  gain: number;
}

/**
 * The post's playhead and its sound (`shared/media/play-clock.ts`, Flight
 * Atlas's store, shared): the stage paints from the clock on every frame and
 * the transport reads it, so a playing post re-renders neither the list nor
 * the inspector. The sound follows the clock — started where the playhead
 * stands when it plays, started again when it is moved while playing,
 * stopped when it stops. A post plays once (no loop).
 */
export function useStoryPlayback(total: number, score: readonly SoundEvent[], files: readonly TimedBuffer[]): PlayClock {
  const clock = useMemo(() => {
    const c = new PlayClock();
    c.loop = false;
    return c;
  }, []);
  useEffect(() => clock.setTotal(total), [clock, total]);

  // What to play, read when the sound starts — a change while playing takes effect at the next start.
  const sound = useRef({ score, files });
  sound.current = { score, files };
  const audio = useRef<{ ctx: AudioContext; nodes: AudioScheduledSourceNode[] } | null>(null);

  useEffect(() => {
    const stop = () => {
      for (const n of audio.current?.nodes ?? []) {
        try {
          n.stop();
        } catch {
          // already ended
        }
      }
      if (audio.current) audio.current.nodes = [];
    };
    const start = (from: number) => {
      stop();
      const { score, files } = sound.current;
      if (typeof AudioContext === 'undefined' || (!score.length && !files.length)) return;
      const ctx = audio.current?.ctx ?? new AudioContext();
      audio.current = { ctx, nodes: [] };
      void ctx.resume();
      for (const e of score) {
        if (e.at >= from) scheduleVoice(ctx, ctx.destination, ctx.currentTime + (e.at - from), e.voice, { gain: e.gain, rate: e.rate });
      }
      for (const s of files) {
        if (s.at + s.buffer.duration <= from) continue;
        const node = ctx.createBufferSource();
        node.buffer = s.buffer;
        const gain = ctx.createGain();
        gain.gain.value = s.gain;
        node.connect(gain).connect(ctx.destination);
        node.start(ctx.currentTime + Math.max(0, s.at - from), Math.max(0, from - s.at));
        audio.current.nodes.push(node);
      }
    };
    // Where the playhead should be if nothing but time moved it: a jump past it is a seek.
    let was = { playing: clock.playing, t: clock.t, at: performance.now() };
    const off = clock.subscribe(() => {
      const now = performance.now();
      const expected = was.t + (was.playing ? (now - was.at) / 1000 : 0);
      if (clock.playing && (!was.playing || Math.abs(clock.t - expected) > 0.25)) start(clock.t);
      else if (!clock.playing && was.playing) stop();
      was = { playing: clock.playing, t: clock.t, at: now };
    });
    return () => {
      off();
      stop();
    };
  }, [clock]);

  // A post closed while playing leaves no sound behind.
  useEffect(() => () => clock.setPlaying(false), [clock]);
  return clock;
}

/** Re-render with the clock: its playhead and whether it plays. For the few parts that show them. */
export function useClock(clock: PlayClock): { t: number; playing: boolean; total: number } {
  useSyncExternalStore(clock.subscribe, clock.getVersion);
  return { t: clock.t, playing: clock.playing, total: clock.total };
}
