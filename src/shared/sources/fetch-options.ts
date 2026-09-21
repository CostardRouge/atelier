/**
 * What a fetch of a media's bytes can be handed (T2 of
 * `docs/progress-feedback.md`, 2026-09-21): a signal to stop it, and a
 * callback for how far it is. Every thunk that brings a file across —
 * `MediaOrigin.fetchOriginal`, a companion's `fetchFile`, the Winnow
 * client's own — takes one, so a task can say the bytes and cancel them.
 */

export interface FetchOptions {
  signal?: AbortSignal;
  /** Bytes read so far, and the whole where the server said it (else null). */
  onProgress?: (done: number, total: number | null) => void;
}

export type FetchFile = (opts?: FetchOptions) => Promise<File>;

/** True for the error a cancelled fetch (or any aborted work) rejects with. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : err instanceof Error && err.name === 'AbortError';
}
