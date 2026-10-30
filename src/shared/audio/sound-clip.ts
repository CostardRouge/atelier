/**
 * Recorded sound in a bed — a voice-over, a music track, a sound effect read
 * from a file — placed at a time in the clip.
 *
 * The bed began as synthesised ticks only (`render-bed.ts`, `voices.ts`); a
 * narrated piece needs the author's own recordings in the same offline render,
 * so they reach the same AAC track, ahead of the same encoder priming.
 *
 * `clipWindow` is the arithmetic (pure, tested): where a clip starts in the
 * bed, from where in its own file, for how long. `scheduleClips` hands that to
 * a context; `decodeSoundFile` turns a dropped file into a buffer.
 */

import { BED_SAMPLE_RATE } from './render-bed';

export interface SoundClip {
  /** The decoded sound. Only `duration` is read by the arithmetic. */
  buffer: AudioBuffer;
  /** Where it starts in the clip, in seconds. */
  at: number;
  /** Where to start reading inside the file, in seconds (default 0). */
  from?: number;
  /** Linear gain, 1 = as recorded. */
  gain?: number;
  /** Seconds of fade at each end (default none). */
  fadeIn?: number;
  fadeOut?: number;
}

export interface ClipWindow {
  /** When the source starts, in the bed's own time. */
  when: number;
  /** Where in the file it starts reading. */
  offset: number;
  /** How long it plays. */
  duration: number;
}

/**
 * Where a clip of `length` seconds sits in a bed of `seconds`, rendered
 * `lead` seconds early (the AAC priming, see `aacPrimingSeconds`). Null when
 * nothing of it is audible inside the bed.
 *
 * A clip that would have to start before zero once moved early is CUT at its
 * head rather than delayed: the rest stays on its frames, which is what a
 * voice synced to captions needs.
 */
export function clipWindow(
  clip: { at: number; from?: number },
  length: number,
  seconds: number,
  lead = 0,
): ClipWindow | null {
  if (!Number.isFinite(clip.at) || !(length > 0) || !(seconds > 0)) return null;
  const from = Math.max(0, Number.isFinite(clip.from) ? (clip.from as number) : 0);
  let when = clip.at - Math.max(0, lead);
  let offset = from;
  if (when < 0) {
    offset -= when;
    when = 0;
  }
  if (offset >= length || when >= seconds) return null;
  const duration = Math.min(length - offset, seconds - when);
  return duration > 0 ? { when, offset, duration } : null;
}

/** Schedule recorded clips into a context, each through its own gain. */
export function scheduleClips(
  ctx: BaseAudioContext,
  destination: AudioNode,
  clips: readonly SoundClip[],
  seconds: number,
  lead = 0,
): number {
  let scheduled = 0;
  for (const clip of clips) {
    const win = clipWindow(clip, clip.buffer.duration, seconds, lead);
    if (!win) continue;
    const source = ctx.createBufferSource();
    source.buffer = clip.buffer;
    const gain = ctx.createGain();
    const level = Math.max(0, Number.isFinite(clip.gain) ? (clip.gain as number) : 1);
    const end = win.when + win.duration;
    const fadeIn = Math.min(Math.max(0, clip.fadeIn ?? 0), win.duration / 2);
    const fadeOut = Math.min(Math.max(0, clip.fadeOut ?? 0), win.duration / 2);
    gain.gain.setValueAtTime(fadeIn > 0 ? 0 : level, win.when);
    if (fadeIn > 0) gain.gain.linearRampToValueAtTime(level, win.when + fadeIn);
    if (fadeOut > 0) {
      gain.gain.setValueAtTime(level, end - fadeOut);
      gain.gain.linearRampToValueAtTime(0, end);
    }
    source.connect(gain);
    gain.connect(destination);
    source.start(win.when, win.offset, win.duration);
    scheduled += 1;
  }
  return scheduled;
}

/**
 * Decode a sound file (WAV, MP3, AAC, whatever this browser reads) at the
 * bed's rate. Null when the browser cannot read it — the caller says so; a
 * clip without its voice is the author's call, not something to hide.
 */
export async function decodeSoundFile(file: Blob, sampleRate = BED_SAMPLE_RATE): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const bytes = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 1, sampleRate);
    return await ctx.decodeAudioData(bytes);
  } catch {
    return null;
  }
}
