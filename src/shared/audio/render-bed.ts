/**
 * A hook's sound bed, rendered offline from its score.
 *
 * The score (`SoundEvent[]`) is times and voice names — known before a single
 * frame is drawn, because a variant's plan is declarative. That is the
 * simplification over the `p5-templates` pipeline this is descended from: there
 * a sketch is imperative, so every `trigger()` has to be LOGGED during the
 * render and replayed afterwards; here the events are handed over up front and
 * rendered once, with no capture mode and nothing to reset between slides.
 *
 * Rendered into an `OfflineAudioContext` through the same voices the editor
 * plays live (`voices.ts`), so what the author hears while composing is what
 * the file carries.
 */

import type { SoundEvent } from './sound-event';
import { scheduleVoice } from './voices';

/** The bed's format — what the AAC encoder is asked for and platforms expect. */
export const BED_SAMPLE_RATE = 48_000;
export const BED_CHANNELS = 2;

/**
 * Headroom on the master bus. Voices peak near 1 on their own, and two landing
 * within a few milliseconds of each other at the fast start of a sweep would
 * otherwise sum past full scale and clip.
 */
const MASTER_GAIN = 0.7;

/** The events a bed of `seconds` can actually play: in its span, in time order. */
export function eventsWithin(events: readonly SoundEvent[], seconds: number): SoundEvent[] {
  return events
    .filter((event) => Number.isFinite(event.at) && event.at >= 0 && event.at < seconds)
    .slice()
    .sort((a, b) => a.at - b.at);
}

/**
 * Schedule a score into any context, from `offset` seconds of it onward, with
 * its own time base starting at `when`. The live editor and the offline render
 * both go through here, so neither can drift from the other.
 */
export function scheduleScore(
  ctx: BaseAudioContext,
  destination: AudioNode,
  events: readonly SoundEvent[],
  when: number,
  offset = 0,
): number {
  let scheduled = 0;
  for (const event of events) {
    if (event.at < offset) continue;
    scheduleVoice(ctx, destination, when + (event.at - offset), event.voice, {
      gain: event.gain,
      rate: event.rate,
    });
    scheduled += 1;
  }
  return scheduled;
}

/**
 * Render `seconds` of bed. Null when there is nothing to play, or when this
 * browser has no `OfflineAudioContext` — in both cases the video is simply
 * silent, which is what it was before the bed existed.
 */
export async function renderBed(
  events: readonly SoundEvent[],
  seconds: number,
  {
    leadSeconds = 0,
    sampleRate = BED_SAMPLE_RATE,
    channels = BED_CHANNELS,
  }: {
    /**
     * Render every sound this much EARLY. An encoder that primes (AAC delays
     * its signal by a fixed number of samples) pushes it back onto its frame;
     * a sound in the first `leadSeconds` cannot move earlier than zero and
     * lands up to that much late, which on the scrub is only the sweep's
     * opening tick. See `aacPrimingSeconds`.
     */
    leadSeconds?: number;
    /**
     * The format to render at. A bed mixed into a clip is rendered at the
     * CLIP's rate and layout, so the two can be summed sample for sample.
     */
    sampleRate?: number;
    channels?: number;
  } = {},
): Promise<AudioBuffer | null> {
  const playable = eventsWithin(events, seconds);
  if (!playable.length || !(seconds > 0)) return null;
  if (typeof OfflineAudioContext === 'undefined') return null;

  const rate = sampleRate > 0 ? sampleRate : BED_SAMPLE_RATE;
  const layout = Math.max(1, Math.min(2, Math.round(channels) || BED_CHANNELS));
  const length = Math.max(1, Math.ceil(seconds * rate));
  const ctx = new OfflineAudioContext(layout, length, rate);
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);
  const lead = Math.max(0, leadSeconds);
  scheduleScore(
    ctx,
    master,
    playable.map((event) => ({ ...event, at: Math.max(0, event.at - lead) })),
    0,
  );
  return ctx.startRendering();
}
