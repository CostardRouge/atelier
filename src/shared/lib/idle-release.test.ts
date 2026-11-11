import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idleRelease } from './idle-release';

describe('an engine let go once it rests', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes after its rest, never under a run, and a new run cancels the rest', () => {
    const release = vi.fn();
    const idle = idleRelease({ restMs: () => 1000, release, onHidden: false });
    idle.busy();
    idle.busy();
    idle.settled();
    vi.advanceTimersByTime(5000);
    expect(release).not.toHaveBeenCalled();
    idle.settled();
    vi.advanceTimersByTime(600);
    idle.busy();
    vi.advanceTimersByTime(5000);
    expect(release).not.toHaveBeenCalled();
    idle.settled();
    vi.advanceTimersByTime(999);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('is kept for good where the device says so', () => {
    const release = vi.fn();
    const idle = idleRelease({ restMs: () => null, release, onHidden: false });
    idle.busy();
    idle.settled();
    vi.advanceTimersByTime(10 * 60_000);
    expect(release).not.toHaveBeenCalled();
  });

  it('forgets a pending release when asked', () => {
    const release = vi.fn();
    const idle = idleRelease({ restMs: () => 100, release, onHidden: false });
    idle.busy();
    idle.settled();
    idle.cancel();
    vi.advanceTimersByTime(1000);
    expect(release).not.toHaveBeenCalled();
  });
});
