/**
 * Give the main thread a turn between two bands of a long loop.
 *
 * A decode's post-processing runs for a few hundred milliseconds on a phone;
 * done in one go it holds the thread, so the task pill cannot paint and its
 * Cancel cannot be pressed until it is over. Sliced into bands with this
 * between them, a press lands between two bands and the work stops there.
 *
 * `scheduler.yield()` where the browser has it (it resumes ahead of other
 * tasks); a zero timeout everywhere else, node included.
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}
