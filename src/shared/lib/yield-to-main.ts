/**
 * Give the main thread a turn between two bands of a long loop.
 *
 * A decode's post-processing runs for a few hundred milliseconds on a phone;
 * done in one go it holds the thread, so the task pill cannot paint and its
 * Cancel cannot be pressed until it is over. Sliced into bands with this
 * between them, a press lands between two bands and the work stops there.
 *
 * `scheduler.yield()` where the browser has it (Chrome, Edge: it resumes
 * ahead of other tasks). Elsewhere a `MessageChannel` message, which is a
 * macrotask every browser runs at once — a zero `setTimeout` is NOT: after
 * a few nested turns browsers stretch it to 4 ms, and a whole-picture
 * conversion has a few hundred bands, so Safari would have paid a second of
 * waiting for nothing. The channel is made once and reused, and its answers
 * go to a QUEUE: two subsystems (a RAW decode's bands, Flight Atlas's log
 * loop) can yield at the same moment, and one handler per call let the
 * second overwrite the first — whose awaiter then hung for ever.
 */
let channel: MessageChannel | null = null;
const waiting: Array<() => void> = [];

export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  if (typeof MessageChannel !== 'undefined') {
    channel ??= new MessageChannel();
    const port = channel.port1;
    return new Promise((resolve) => {
      waiting.push(resolve);
      // Listening keeps a node process alive; the handler is dropped once the
      // queue is empty so a spec that yields does not hang the runner.
      port.onmessage ??= () => {
        waiting.shift()?.();
        if (!waiting.length) port.onmessage = null;
      };
      channel!.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
