/**
 * ONE fetch per original, however many readers want it — and held for the
 * session when it lands (`original-cache.ts`).
 *
 * The Studio's stage and its export both reach for a clip's capture: the stage
 * when the author switches it from the proxy to the original, the export when
 * it delivers. A 4K rush is a gigabyte through a tunnel, so a second reader
 * must JOIN the fetch already under way rather than start its own, and the
 * file must be held once it lands so that neither pays for it again.
 *
 * Every reader brings its own `signal`, and letting go is its own business: a
 * reader that aborts rejects at once with an `AbortError`, and the fetch
 * itself stops only when NO reader is left waiting — an export cancelled
 * while the stage still wants the file must not take the stage's bytes with
 * it. The task's own Cancel (the masthead pill, the stage's edge) stops the
 * fetch for everyone, which is what a person pressing it means.
 */

import { trackedFetch, type TrackedFetchInit } from '../tasks/tracked';
import type { FetchFile } from './fetch-options';
import { heldOriginal, holdOriginal } from './original-cache';

interface Flight {
  job: Promise<File>;
  controller: AbortController;
  waiting: number;
}

const flights = new Map<string, Flight>();

function cancelled(label: string): DOMException {
  return new DOMException(`${label} was cancelled`, 'AbortError');
}

/** True while a fetch for `key` is under way — for a line that says so. */
export function isFetchingHeld(key: string): boolean {
  return flights.has(key);
}

/**
 * The original held under `key`, else the fetch already bringing it, else a
 * new one: a TASK (`trackedFetch`, named by `init`) whose file is held under
 * `key` when it lands.
 */
export function fetchHeld(
  key: string,
  init: Omit<TrackedFetchInit, 'signal'>,
  fetch: FetchFile,
  signal?: AbortSignal,
): Promise<File> {
  const held = heldOriginal(key);
  if (held) return Promise.resolve(held);
  if (signal?.aborted) return Promise.reject(cancelled(init.label));
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const job = trackedFetch({ ...init, signal: controller.signal }, (opts) => fetch(opts)).then((file) => {
      holdOriginal(key, file);
      return file;
    });
    const started: Flight = { job, controller, waiting: 0 };
    flights.set(key, started);
    const forget = () => {
      if (flights.get(key) === started) flights.delete(key);
    };
    job.then(forget, forget);
    flight = started;
  }
  const joined = flight;
  joined.waiting += 1;
  return new Promise<File>((resolve, reject) => {
    let settled = false;
    const leave = () => {
      settled = true;
      joined.waiting -= 1;
      signal?.removeEventListener('abort', onAbort);
    };
    function onAbort() {
      if (settled) return;
      leave();
      // The last reader gone: nobody wants these bytes any more.
      if (joined.waiting <= 0) joined.controller.abort();
      reject(cancelled(init.label));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    joined.job.then(
      (file) => {
        if (settled) return;
        leave();
        resolve(file);
      },
      (err: unknown) => {
        if (settled) return;
        leave();
        reject(err);
      },
    );
  });
}
