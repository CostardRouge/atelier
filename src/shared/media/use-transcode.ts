/**
 * React access to the shared {@link transcodeStore}, for a single source file.
 *
 * Subscribes a component to one file's transcode state so it re-renders on
 * progress / completion, and exposes `request`/`cancel` bound to that file.
 * Pass `null` (e.g. no active clip) and you get an inert idle state.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  IDLE_ENTRY,
  transcodeStore,
  type TranscodeEntry,
} from './transcode-store';

export interface UseTranscode {
  status: TranscodeEntry['status'];
  ratio: number | null;
  /** The transcoded H.264 file, once ready; null otherwise. */
  transcoded: File | null;
  error: string | null;
  /** Start (or no-op if already running/done). */
  request: () => void;
  /** Abort an in-flight run; leaves it retryable. */
  cancel: () => void;
}

export function useTranscode(file: File | null): UseTranscode {
  const entry = useSyncExternalStore(
    transcodeStore.subscribe,
    () => (file ? transcodeStore.get(file) : IDLE_ENTRY),
    () => IDLE_ENTRY,
  );

  const request = useCallback(() => {
    if (file) transcodeStore.request(file);
  }, [file]);
  const cancel = useCallback(() => {
    if (file) transcodeStore.cancel(file);
  }, [file]);

  return {
    status: entry.status,
    ratio: entry.ratio,
    transcoded: entry.file,
    error: entry.error,
    request,
    cancel,
  };
}
