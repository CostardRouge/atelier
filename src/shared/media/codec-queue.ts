/**
 * Backpressure on a WebCodecs queue — wait until a codec has taken its queue
 * below `max`.
 *
 * This used to poll every 5 ms. In a hidden tab a browser throttles every
 * timer to a second at least (and Chrome's intensive throttling to a minute),
 * so an export put in the background waited a second per FRAME: a clip that
 * encodes in a minute took hours. A codec says itself when its queue shrinks —
 * the `dequeue` event, which is not a timer and is not throttled — so the wait
 * listens for that, and keeps a slow timer only as the floor for a codec
 * that never fires one (a browser without the event, a codec that closed).
 *
 * DOM-free: an `EventTarget` is all it needs, which node has too.
 */

/** The fallback poll — only reached where no `dequeue` event arrives. */
export const QUEUE_POLL_MS = 250;

/**
 * How long a queue may stay FULL without moving before the codec is called
 * stalled. A hardware encoder that died, or a Safari that stopped answering,
 * leaves `encodeQueueSize` where it was and fires nothing: the loop below
 * would otherwise poll it forever, with the run's Cancel never reached.
 */
export const QUEUE_STALL_MS = 30_000;

/**
 * Block until `getSize()` is at most `max`, woken by `codec`'s `dequeue`
 * events. Throws an AbortError the moment `signal` aborts (a Cancel must
 * reach a wait that may hold the run for seconds), and an Error once the
 * queue has not moved for `QUEUE_STALL_MS`.
 */
export async function awaitQueue(
  getSize: () => number,
  max: number,
  codec?: EventTarget | null,
  signal?: AbortSignal,
  stallMs: number = QUEUE_STALL_MS,
): Promise<void> {
  let lastSize = getSize();
  let stillSince = Date.now();
  while (getSize() > max) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const size = getSize();
    if (size !== lastSize) {
      lastSize = size;
      stillSince = Date.now();
    } else if (Date.now() - stillSince > stallMs) {
      throw new Error(`The video encoder stopped answering: its queue has not moved for ${Math.round(stallMs / 1000)} s.`);
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        codec?.removeEventListener('dequeue', done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, QUEUE_POLL_MS);
      codec?.addEventListener('dequeue', done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
