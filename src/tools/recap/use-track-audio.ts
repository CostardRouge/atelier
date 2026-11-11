/**
 * Listening to a track of a network's music library before it is sent (lab
 * 18): Postiz's search gives a signed address on the network's own servers
 * (`previewUrl`), played by the browser's own player. Studying it — its
 * waveform and its tempo — reads the same file once into memory. Nothing of
 * it is kept on the device, and nothing of it ever enters a file Recap makes:
 * the network lays its own copy over the Reel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { monoOf } from '../../shared/audio/listen';
import { wavePeaks } from '../../shared/audio/peaks';
import { decodeSoundFile } from '../../shared/audio/sound-clip';
import type { RecapBeat } from '../../shared/recap/recap-beat';
import type { MusicTrack } from '../../shared/sources/postiz/networks';
import { beatOfBuffer } from './recap-beat-find';

export interface TrackStudy {
  /** The waveform as bars, 0–1; null when this browser could not read the file. */
  peaks: number[] | null;
  beat: RecapBeat | null;
}

export const WAVE_BARS = 64;
const NOTHING: TrackStudy = { peaks: null, beat: null };
/** By track id, for the visit. */
const studies = new Map<string, Promise<TrackStudy>>();

/** A track's waveform and tempo, read once; nothing when the file cannot be fetched or decoded here. */
export function studyTrack(track: Pick<MusicTrack, 'id' | 'previewUrl'>): Promise<TrackStudy> {
  if (!track.previewUrl) return Promise.resolve(NOTHING);
  const kept = studies.get(track.id);
  if (kept) return kept;
  const made = (async (): Promise<TrackStudy> => {
    try {
      const res = await fetch(track.previewUrl!, { credentials: 'omit' });
      if (!res.ok) return NOTHING;
      const buffer = await decodeSoundFile(await res.blob());
      if (!buffer) return NOTHING;
      const mono = monoOf(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
      return { peaks: wavePeaks(mono, WAVE_BARS), beat: beatOfBuffer(buffer) };
    } catch {
      return NOTHING;
    }
  })();
  studies.set(track.id, made);
  // A file that could not be read now may be readable after a new search gave a fresh address.
  void made.then((s) => s === NOTHING && studies.delete(track.id));
  return made;
}

/** A track's study, once it is there. */
export function useTrackStudy(track: MusicTrack | null): TrackStudy | null {
  const [study, setStudy] = useState<TrackStudy | null>(null);
  useEffect(() => {
    let alive = true;
    setStudy(null);
    if (track) void studyTrack(track).then((s) => alive && setStudy(s));
    return () => {
      alive = false;
    };
  }, [track?.id, track?.previewUrl]);
  return study;
}

/** One player for the picker: the track playing, how far, and why one could not play. */
export function useTrackPlayer(): { playing: string | null; progress: number; failed: string | null; toggle: (track: MusicTrack) => void; stop: () => void } {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(null);
    setProgress(0);
  }, []);
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current?.removeAttribute('src');
      audio.current = null;
    },
    [],
  );
  const toggle = useCallback(
    (track: MusicTrack) => {
      if (playing === track.id) return stop();
      if (!track.previewUrl) return setFailed(track.id);
      const a = audio.current ?? new Audio();
      audio.current = a;
      a.pause();
      a.src = track.previewUrl;
      a.ontimeupdate = () => setProgress(a.duration > 0 ? a.currentTime / a.duration : 0);
      a.onended = () => stop();
      a.onerror = () => {
        setFailed(track.id);
        stop();
      };
      setFailed(null);
      setProgress(0);
      setPlaying(track.id);
      void a.play().catch(() => {
        setFailed(track.id);
        stop();
      });
    },
    [playing, stop],
  );
  return { playing, progress, failed, toggle, stop };
}
