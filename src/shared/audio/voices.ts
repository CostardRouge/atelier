/**
 * The suite's small synthesised voices — ticks, knocks, blips — scheduled into
 * any Web Audio context.
 *
 * Ported from the maintainer's own `p5-templates` (`src/lib/clickSynth.ts`),
 * whose one rule is the whole reason this works: **a voice only ever touches
 * the `ctx` and `destination` it is handed**. That is what lets one table serve
 * a live `AudioContext` in the editor (`when = ctx.currentTime + offset`) and an
 * `OfflineAudioContext` at export (`when = the event's own time`) with no code
 * of its own for either.
 *
 * Two departures from the original, both for the export:
 *
 * - **The noise is seeded.** `Math.random()` made every offline render differ
 *   by a hair; a bed rendered from a seeded generator is the same file every
 *   time the same piece is exported.
 * - **Three voices for the scrub** (`detent`, `leg`, `seat`) join the seven
 *   originals. A variant names a voice; it never builds an oscillator.
 *
 * DOM-free apart from the Web Audio types it schedules into.
 */

/** exponentialRamp cannot reach true zero. */
const MIN_GAIN = 0.0001;

export const VOICE_NAMES = [
  'click',
  'tick',
  'blip',
  'pop',
  'beep',
  'wood',
  'typewriter',
  'detent',
  'leg',
  'seat',
] as const;

export type VoiceName = (typeof VOICE_NAMES)[number];

export function isVoice(name: unknown): name is VoiceName {
  return typeof name === 'string' && (VOICE_NAMES as readonly string[]).includes(name);
}

export interface VoiceParams {
  /** Peak level, 0..1. */
  gain?: number;
  /** Pitch multiplier: 1 as designed, 2 an octave up, 0.5 an octave down. */
  rate?: number;
}

/**
 * A small deterministic generator (mulberry32). Seeded per hit from its time,
 * so two hits at different moments do not share one texture and the same hit
 * renders identically on every export.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ToneSpec {
  type?: OscillatorType;
  freq: number;
  endFreq?: number;
  duration?: number;
  attack?: number;
  gain?: number;
  delay?: number;
}

function tone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  { type = 'sine', freq, endFreq, duration = 0.05, attack = 0.001, gain = 0.5, delay = 0 }: ToneSpec,
): void {
  const start = when + delay;
  const osc = ctx.createOscillator();
  const envelope = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), start);
  if (endFreq && endFreq > 0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + duration);
  }
  envelope.gain.setValueAtTime(MIN_GAIN, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN, gain), start + attack);
  envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, start + duration);
  osc.connect(envelope);
  envelope.connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
  osc.onended = () => {
    osc.disconnect();
    envelope.disconnect();
  };
}

interface NoiseSpec {
  freq: number;
  q?: number;
  duration?: number;
  gain?: number;
  delay?: number;
}

function noiseHit(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  { freq, q = 1, duration = 0.03, gain = 0.3, delay = 0 }: NoiseSpec,
): void {
  const start = when + delay;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seeded(Math.round(start * 1000) + Math.round(freq));
  for (let i = 0; i < frames; i++) data[i] = (random() * 2 - 1) * (1 - i / frames);

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const envelope = ctx.createGain();
  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = Math.max(1, freq);
  filter.Q.value = q;
  envelope.gain.value = gain;
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(destination);
  source.start(start);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  };
}

type Voice = (
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  gain: number,
  rate: number,
) => void;

const VOICES: Record<VoiceName, Voice> = {
  // --- the seven originals, as designed in p5-templates ---------------------

  /** Soft camera-shutter tick: a filtered noise snap over a faint sine body. */
  click: (ctx, dest, when, gain, rate) => {
    noiseHit(ctx, dest, when, { freq: 2400 * rate, q: 3, duration: 0.025, gain });
    tone(ctx, dest, when, { freq: 1800 * rate, duration: 0.02, gain: gain * 0.35 });
  },
  /** Bright, dry metronome tick. */
  tick: (ctx, dest, when, gain, rate) => {
    noiseHit(ctx, dest, when, { freq: 3200 * rate, q: 1.5, duration: 0.03, gain });
  },
  /** Short rounded triangle blip. */
  blip: (ctx, dest, when, gain, rate) => {
    tone(ctx, dest, when, { type: 'triangle', freq: 1300 * rate, duration: 0.05, attack: 0.002, gain });
  },
  /** Bubble pop: a fast downward sweep. */
  pop: (ctx, dest, when, gain, rate) => {
    tone(ctx, dest, when, { freq: 520 * rate, endFreq: 160 * rate, duration: 0.09, attack: 0.002, gain });
  },
  /** Plain sine beep — the longest, reads as a confirmation. */
  beep: (ctx, dest, when, gain, rate) => {
    tone(ctx, dest, when, { freq: 880 * rate, duration: 0.12, attack: 0.004, gain });
  },
  /** Woodblock: a resonant low knock over a short thump. */
  wood: (ctx, dest, when, gain, rate) => {
    noiseHit(ctx, dest, when, { freq: 950 * rate, q: 8, duration: 0.06, gain });
    tone(ctx, dest, when, { freq: 220 * rate, endFreq: 180 * rate, duration: 0.05, gain: gain * 0.5 });
  },
  /** Two-part key strike: hammer, then rebound. */
  typewriter: (ctx, dest, when, gain, rate) => {
    noiseHit(ctx, dest, when, { freq: 2000 * rate, q: 2, duration: 0.02, gain });
    noiseHit(ctx, dest, when, { freq: 1400 * rate, q: 2, duration: 0.03, gain: gain * 0.6, delay: 0.03 });
  },

  // --- the scrub's three --------------------------------------------------------

  /**
   * The ordinary landing: a ratchet, not a beep. Narrow band-passed noise with
   * a hard decay; only its spacing and its level change along a sweep.
   */
  detent: (ctx, dest, when, gain, rate) => {
    noiseHit(ctx, dest, when, { freq: 2200 * rate, q: 6, duration: 0.06, gain });
    tone(ctx, dest, when, { freq: 1600 * rate, duration: 0.018, gain: gain * 0.25 });
  },
  /**
   * A leg of the trip starting: the detent an octave down and a little louder.
   * It is the only sound that carries meaning, so it is the only one that is
   * different — a listener hears the trip's legs go past.
   */
  leg: (ctx, dest, when, gain, rate) => {
    noiseHit(ctx, dest, when, { freq: 1100 * rate, q: 3.5, duration: 0.11, gain: Math.min(1, gain * 1.4) });
    tone(ctx, dest, when, { freq: 420 * rate, endFreq: 300 * rate, duration: 0.06, gain: gain * 0.35 });
  },
  /**
   * The seat: the head coming to rest on today. A low body with a click on
   * top — it ends the phrase, and without it a sweep sounds cut off.
   */
  seat: (ctx, dest, when, gain, rate) => {
    tone(ctx, dest, when, { freq: 190 * rate, endFreq: 120 * rate, duration: 0.22, attack: 0.006, gain });
    noiseHit(ctx, dest, when, { freq: 2200 * rate, q: 6, duration: 0.05, gain: gain * 0.7 });
  },
};

/**
 * Schedule one voice at `when`, in the context's own time base. An unknown name
 * falls back to `click` — a score written by a newer build still makes a sound
 * where one was meant — and the level and pitch are clamped to what the voices
 * were designed around.
 */
export function scheduleVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  voice: string,
  { gain = 0.5, rate = 1 }: VoiceParams = {},
): void {
  const play = VOICES[isVoice(voice) ? voice : 'click'];
  play(ctx, destination, Math.max(0, when), Math.max(0, Math.min(1, gain)), Math.max(0.05, rate));
}
