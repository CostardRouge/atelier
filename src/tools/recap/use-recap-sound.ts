import { useEffect, useRef, useState } from 'react';
import type { RecapDoc } from '../../shared/recap/recap-doc';
import { getSound, type KeptSound } from './recap-store';
import type { SoundEvent } from '../../shared/audio/sound-event';
import { scheduleVoice } from '../../shared/audio/voices';

/** The gain the bed is heard at `t` seconds into a film of `total`: its fades at both ends. */
export function soundGain(t: number, total: number, gain: number, fade: number): number {
  if (fade <= 0) return gain;
  const k = Math.min(1, t / fade, (total - t) / fade);
  return gain * Math.max(0, k);
}

/**
 * The recap's sound as the stage plays it: the file kept for this recap on
 * the device, looped from the film's own time so the preview and the export
 * hear the same bar at the same frame, its fades applied. Paused with the
 * stage. The export renders it offline (`render-bed.ts`), never from here.
 */
export function useRecapSound(doc: RecapDoc): {
  kept: KeptSound | null;
  drive: (t: number, total: number) => void;
  /** The opener's ticks from film time `from` on, scheduled once as the stage starts playing (the export mixes them itself). */
  cue: (events: readonly SoundEvent[], from: number) => void;
  halt: () => void;
  reload: () => void;
} {
  const [kept, setKept] = useState<KeptSound | null>(null);
  const [nonce, setNonce] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const name = doc.sound?.name ?? null;

  useEffect(() => {
    let alive = true;
    if (!name) {
      setKept(null);
      return;
    }
    void getSound(doc.id).then((s) => alive && setKept(s && s.name === name ? s : null));
    return () => {
      alive = false;
    };
  }, [doc.id, name, nonce]);

  useEffect(() => {
    if (!kept) return;
    const u = URL.createObjectURL(kept.blob);
    const a = new Audio(u);
    a.loop = true;
    a.preload = 'auto';
    audio.current = a;
    url.current = u;
    return () => {
      a.pause();
      a.removeAttribute('src');
      URL.revokeObjectURL(u);
      audio.current = null;
      url.current = null;
    };
  }, [kept]);

  const docRef = useRef(doc);
  docRef.current = doc;
  const drive = (t: number, total: number) => {
    const a = audio.current;
    const s = docRef.current.sound;
    if (!a || !s) return;
    const loop = s.seconds > 0 ? s.seconds : a.duration || 0;
    if (loop <= 0) return;
    const want = t % loop;
    a.volume = Math.min(1, soundGain(t, total, s.gain, s.fade));
    if (a.paused) {
      a.currentTime = want;
      void a.play().catch(() => undefined);
    } else if (Math.abs(a.currentTime - want) > 0.2 && Math.abs(a.currentTime - want) < loop - 0.2) {
      a.currentTime = want;
    }
  };
  const ticks = useRef<{ ctx: AudioContext; bus: GainNode | null } | null>(null);
  const silence = () => {
    ticks.current?.bus?.disconnect();
    if (ticks.current) ticks.current.bus = null;
  };
  const cue = (events: readonly SoundEvent[], from: number) => {
    silence();
    const ahead = events.filter((e) => e.at >= from);
    if (!ahead.length || typeof AudioContext === 'undefined') return;
    if (!ticks.current) ticks.current = { ctx: new AudioContext(), bus: null };
    const { ctx } = ticks.current;
    void ctx.resume().catch(() => undefined);
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    ticks.current.bus = bus;
    const base = ctx.currentTime + 0.02;
    for (const e of ahead) scheduleVoice(ctx, bus, base + e.at - from, e.voice, { gain: e.gain, rate: e.rate });
  };
  useEffect(
    () => () => {
      ticks.current?.bus?.disconnect();
      void ticks.current?.ctx.close().catch(() => undefined);
      ticks.current = null;
    },
    [],
  );
  const halt = () => {
    audio.current?.pause();
    silence();
  };
  return { kept, drive, cue, halt, reload: () => setNonce((n) => n + 1) };
}
