import { afterEach, describe, expect, it } from 'vitest';
import { fetchHeld, isFetchingHeld } from './held-fetch';
import { dropHeldOriginals, heldOriginal, holdOriginal } from './original-cache';
import { cancelTask, clearTasks, listTasks } from '../tasks/tasks';
import type { FetchOptions } from './fetch-options';

const file = (name: string) => new File([new Uint8Array(8)], name);

/** A fetch the test finishes by hand, counting how many times it was started. */
function gate() {
  const calls: FetchOptions[] = [];
  let finish: (f: File) => void = () => {};
  const fetch = (opts: FetchOptions = {}) => {
    calls.push(opts);
    return new Promise<File>((resolve, reject) => {
      finish = resolve;
      opts.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
    });
  };
  return { fetch, calls, finish: (f: File) => finish(f) };
}

const init = { label: 'Fetching DJI_0001.MP4', scope: 'w/1', bytes: 8 };

afterEach(() => {
  dropHeldOriginals();
  clearTasks();
});

describe('one fetch per original', () => {
  it('answers from the session cache without fetching', async () => {
    holdOriginal('w/1', file('held.mp4'));
    const g = gate();
    await expect(fetchHeld('w/1', init, g.fetch)).resolves.toHaveProperty('name', 'held.mp4');
    expect(g.calls).toHaveLength(0);
  });

  it('lets a second reader JOIN the fetch under way, and holds what lands', async () => {
    const g = gate();
    const stage = fetchHeld('w/1', init, g.fetch);
    const exporter = fetchHeld('w/1', init, g.fetch);
    expect(g.calls).toHaveLength(1);
    expect(isFetchingHeld('w/1')).toBe(true);
    g.finish(file('DJI_0001.MP4'));
    const [a, b] = await Promise.all([stage, exporter]);
    expect(a).toBe(b);
    expect(heldOriginal('w/1')).toBe(a);
    expect(isFetchingHeld('w/1')).toBe(false);
  });

  it('lets one reader go without taking the bytes from another', async () => {
    const g = gate();
    const leaving = new AbortController();
    const exporter = fetchHeld('w/1', init, g.fetch, leaving.signal);
    const stage = fetchHeld('w/1', init, g.fetch);
    leaving.abort();
    await expect(exporter).rejects.toHaveProperty('name', 'AbortError');
    // The fetch itself goes on for the reader still waiting.
    expect(g.calls[0].signal?.aborted).toBe(false);
    g.finish(file('DJI_0001.MP4'));
    await expect(stage).resolves.toHaveProperty('name', 'DJI_0001.MP4');
  });

  it('stops the fetch when the last reader lets go', async () => {
    const g = gate();
    const only = new AbortController();
    const reader = fetchHeld('w/1', init, g.fetch, only.signal);
    only.abort();
    await expect(reader).rejects.toHaveProperty('name', 'AbortError');
    expect(g.calls[0].signal?.aborted).toBe(true);
    // Forgotten once it has settled: the next reader starts afresh.
    await Promise.resolve();
    await Promise.resolve();
    expect(isFetchingHeld('w/1')).toBe(false);
    expect(heldOriginal('w/1')).toBeNull();
  });

  it('is stopped for everyone by its task’s Cancel', async () => {
    const g = gate();
    const a = fetchHeld('w/1', init, g.fetch);
    const b = fetchHeld('w/1', init, g.fetch);
    const task = listTasks().find((t) => t.label === init.label);
    expect(task).toBeTruthy();
    cancelTask(task!.id);
    await expect(a).rejects.toHaveProperty('name', 'AbortError');
    await expect(b).rejects.toHaveProperty('name', 'AbortError');
  });

  it('refuses at once a reader that arrives already cancelled', async () => {
    const g = gate();
    const gone = new AbortController();
    gone.abort();
    await expect(fetchHeld('w/1', init, g.fetch, gone.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(g.calls).toHaveLength(0);
  });
});
