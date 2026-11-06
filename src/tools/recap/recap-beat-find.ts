/**
 * Finding a sound's beat on this device (lab 7, cuts on the beat): the
 * decoded samples through Storytelling's `beatTimes`, kept as a period and a
 * phase (`beatOf`). No network, no model — an energy envelope and its tempo.
 */

import { beatTimes, monoOf } from '../../shared/audio/listen';
import { decodeSoundFile } from '../../shared/audio/sound-clip';
import { beatOf, type RecapBeat } from '../../shared/recap/recap-beat';

/** The beat of a decoded sound, or null when it has no steady pulse. */
export function beatOfBuffer(buffer: AudioBuffer): RecapBeat | null {
  const mono = monoOf(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
  return beatOf(beatTimes(mono, buffer.sampleRate));
}

/** The beat of a kept sound file; null when it cannot be read or has no pulse. */
export async function beatOfFile(blob: Blob): Promise<RecapBeat | null> {
  const buffer = await decodeSoundFile(blob);
  return buffer ? beatOfBuffer(buffer) : null;
}
