/**
 * Letting a heavy engine GO once it rests (2026-11-10, the performance pass:
 * `docs/memory/performance.md`, rule 4). A wasm worker — ffmpeg, the subject
 * model, a decoder — keeps its heap for as long as it lives, and wasm memory
 * never shrinks: on a phone that is the memory iOS reclaims a tab by. The RAW
 * decoder wrote this by hand first (`raw-decoder.ts`); this is its shape as a
 * brick, for every engine that comes after.
 *
 * `idleRelease({ restMs, release })`: the owner calls `busy()` when a run
 * starts and `settled()` when it ends; after `restMs()` of rest (null = never
 * on this device) `release()` runs — never under a run. On a device whose
 * `restMs()` is not null, a hidden tab releases at once (when nothing runs).
 */

export interface IdleRelease {
  /** A run starts: the engine is kept until it settles. */
  busy(): void;
  /** A run ended: the rest starts counting. */
  settled(): void;
  /** Forget a pending release (the engine was let go another way). */
  cancel(): void;
}

export interface IdleReleaseOptions {
  /** How long the engine may rest before it goes, in ms; null keeps it (a roomy machine). */
  restMs: () => number | null;
  release: () => void;
  /** Listen for the tab being hidden (default true; off in node). */
  onHidden?: boolean;
}

export function idleRelease({ restMs, release, onHidden = true }: IdleReleaseOptions): IdleRelease {
  let runs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  if (onHidden && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || runs > 0 || restMs() === null) return;
      cancel();
      release();
    });
  }
  return {
    busy() {
      runs += 1;
      cancel();
    },
    settled() {
      runs = Math.max(0, runs - 1);
      const ms = restMs();
      if (runs > 0 || ms === null) return;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        if (runs === 0) release();
      }, ms);
    },
    cancel,
  };
}
