import { formatBytes } from '../lib/format';
import type { FetchOptions } from '../sources/fetch-options';
import { isAbortError } from '../sources/fetch-options';
import { startTask } from './tasks';

export interface TrackedFetchInit {
  /** What a person asked for: "Fetching DJI_0101.DNG". */
  label: string;
  /** The media it belongs to, for its edge. */
  scope?: string | null;
  /** The whole, where the caller already knows it (a row's `file_size`) — the bar is determinate from the first byte. */
  bytes?: number | null;
  /** An outer cancel — an export's — that ends this fetch too. */
  signal?: AbortSignal;
}

/**
 * Run a fetch as a TASK: registered before the first byte, a bar that moves
 * with the bytes (against the server's `content-length`, else the size the
 * caller knew, else a sweep), a Cancel that aborts the request, and gone the
 * moment it ends however it ends. A cancelled fetch rejects with an
 * `AbortError` whose message names the task, so a caller can say it or stay
 * quiet (`isAbortError`).
 */
export async function trackedFetch<T>(init: TrackedFetchInit, run: (opts: FetchOptions) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const known = init.bytes && init.bytes > 0 ? init.bytes : null;
  const handle = startTask({
    label: init.label,
    scope: init.scope ?? null,
    progress: known ? 0 : null,
    detail: known ? formatBytes(known) : null,
    cancel: () => controller.abort(),
  });
  try {
    return await run({
      signal: controller.signal,
      onProgress: (done, total) => {
        const whole = total ?? known;
        handle.update({
          progress: whole ? Math.min(1, done / whole) : null,
          detail: whole ? `${formatBytes(done)} of ${formatBytes(whole)}` : formatBytes(done),
        });
      },
    });
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) throw new DOMException(`${init.label} was cancelled`, 'AbortError');
    throw err;
  } finally {
    handle.done();
  }
}
