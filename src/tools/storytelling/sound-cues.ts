import { beatTimes, monoOf, speechSpans } from '../../shared/audio/listen';
import type { WallCues } from '../../shared/story/wall-motion';

/** What a file says of its time, read once per decoded buffer (a song's beats take a moment to find). */
const heard = new WeakMap<AudioBuffer, { speech: [number, number][]; beats: number[] }>();
function listen(buffer: AudioBuffer): { speech: [number, number][]; beats: number[] } {
  let got = heard.get(buffer);
  if (!got) {
    const mono = monoOf(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
    got = { speech: speechSpans(mono, buffer.sampleRate), beats: beatTimes(mono, buffer.sampleRate) };
    heard.set(buffer, got);
  }
  return got;
}

/**
 * The post's cues for its smart wall (`wall-motion.ts`): when the voice
 * speaks and where the music's beats fall, on the post's clock (each file
 * starts where it is set), kept to the post's length. Null with no file.
 */
export function soundCues(voice: { buffer: AudioBuffer; at: number } | null, music: { buffer: AudioBuffer; at: number } | null, total: number): WallCues | null {
  if (!voice && !music) return null;
  const speech = voice ? listen(voice.buffer).speech.map(([a, b]) => [a + voice.at, b + voice.at] as const).filter(([a]) => a < total) : undefined;
  const beats = music ? listen(music.buffer).beats.map((b) => b + music.at).filter((b) => b >= 0 && b < total) : undefined;
  return { ...(speech?.length ? { speech } : {}), ...(beats?.length ? { beats } : {}) };
}
