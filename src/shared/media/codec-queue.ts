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

/** Block until `getSize()` is at most `max`, woken by `codec`'s `dequeue` events. */
export async function awaitQueue(
  getSize: () => number,
  max: number,
  codec?: EventTarget | null,
): Promise<void> {
  while (getSize() > max) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        codec?.removeEventListener('dequeue', done);
        resolve();
      };
      const timer = setTimeout(done, QUEUE_POLL_MS);
      codec?.addEventListener('dequeue', done);
    });
  }
}
