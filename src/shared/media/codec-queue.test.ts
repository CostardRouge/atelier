import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitQueue, QUEUE_POLL_MS } from './codec-queue';

afterEach(() => {
  vi.useRealTimers();
});

describe('awaitQueue', () => {
  it('returns at once when the queue is already short enough', async () => {
    await expect(awaitQueue(() => 3, 24)).resolves.toBeUndefined();
  });

  it('wakes on the codec\'s dequeue events, with no timer to wait on', async () => {
    vi.useFakeTimers();
    const codec = new EventTarget();
    let size = 26;
    let settled = false;
    const wait = awaitQueue(() => size, 24, codec).then(() => {
      settled = true;
    });
    size = 25;
    codec.dispatchEvent(new Event('dequeue'));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    size = 24;
    codec.dispatchEvent(new Event('dequeue'));
    await wait;
    expect(settled).toBe(true);
    // No timer was needed, and none is left behind.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to a slow poll where no event ever comes', async () => {
    vi.useFakeTimers();
    let size = 30;
    let settled = false;
    const wait = awaitQueue(() => size, 24).then(() => {
      settled = true;
    });
    size = 10;
    await vi.advanceTimersByTimeAsync(QUEUE_POLL_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(settled).toBe(true);
  });

  it('leaves no listener on the codec once it returns', async () => {
    const codec = new EventTarget();
    const add = vi.spyOn(codec, 'addEventListener');
    const remove = vi.spyOn(codec, 'removeEventListener');
    let size = 25;
    const wait = awaitQueue(() => size, 24, codec);
    size = 0;
    codec.dispatchEvent(new Event('dequeue'));
    await wait;
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
