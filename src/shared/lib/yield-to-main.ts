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
 * waiting for nothing. The channel is made once and reused; a yield is
 * never in flight twice, since every caller awaits its own.
 */
let channel: MessageChannel | null = null;

export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  if (typeof MessageChannel !== 'undefined') {
    channel ??= new MessageChannel();
    const port = channel.port1 as MessagePort & { unref?: () => void };
    return new Promise((resolve) => {
      port.onmessage = () => {
        // Listening keeps a node process alive; a spec that yields once
        // must not hang the runner on the way out.
        port.onmessage = null;
        resolve();
      };
      channel!.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
