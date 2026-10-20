/**
 * Waits that END — on a cancel, on a deadline — whatever the promise under
 * them does.
 *
 * An export is a chain of awaits, and a browser's promises do not all settle:
 * a `<video>` seek that never fires `seeked`, an `OfflineAudioContext` render
 * iOS forgets, a tile fetch down a tunnel, a codec whose queue stops moving.
 * One such await inside a slide is a run that sits on that slide forever and
 * a Cancel that does nothing, because the loop only reads its signal BETWEEN
 * two awaits. These two helpers put the signal and a clock OVER a promise, so
 * the caller is answered even when the promise never is. Pure, DOM-free.
 */

/** The error every cancelled wait throws — what `isAbortError` recognises. */
export function abortError(message = 'Cancelled'): DOMException {
  return new DOMException(message, 'AbortError');
}

/**
 * `promise`, or an AbortError the moment `signal` aborts — even if `promise`
 * never settles. The listener is removed once either side answers.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, message?: string): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(message));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(abortError(message));
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(err);
      },
    );
  });
}

/**
 * `promise`, or — `ms` later with no answer — the value `late` gives, to
 * carry on with (the stage's own choice: draw what is in). The timer is
 * cleared on an answer. `deadline` is the twin that throws instead.
 */
export function withDeadline<T, F>(promise: Promise<T>, ms: number, late: () => F): Promise<T | F> {
  if (!(ms > 0) || !Number.isFinite(ms)) return promise;
  return new Promise<T | F>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(late());
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * `promise`, or — `ms` later with no answer — the error `late` gives, thrown:
 * the sentence the run reports for a wait that never ended.
 */
export function deadline<T>(promise: Promise<T>, ms: number, late: () => Error): Promise<T> {
  if (!(ms > 0) || !Number.isFinite(ms)) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(late());
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * A signal that aborts when `parent` does, or when `abort()` is called — one
 * slide's own cancel under a run's, so a slide that stalls is given up
 * without ending the run.
 */
export function childSignal(parent: AbortSignal | undefined): { signal: AbortSignal; abort: (reason?: string) => void; release: () => void } {
  const controller = new AbortController();
  const follow = () => controller.abort(parent?.reason);
  if (parent?.aborted) follow();
  else parent?.addEventListener('abort', follow, { once: true });
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    release: () => parent?.removeEventListener('abort', follow),
  };
}

/**
 * A watchdog over work that reports its progress: `touch()` on every report,
 * and `onStall` fires once `ms` pass without one. `stop()` disarms it. For a
 * slide whose renderer stopped answering — a decoder that never returns —
 * the only thing that can still say so is that nothing has been said.
 */
export function stallWatch(ms: number, onStall: () => void): { touch: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const arm = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) onStall();
    }, ms);
  };
  if (ms > 0 && Number.isFinite(ms)) arm();
  return {
    touch: () => {
      if (!stopped && ms > 0 && Number.isFinite(ms)) arm();
    },
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
