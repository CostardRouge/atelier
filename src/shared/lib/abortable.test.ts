import { describe, expect, it, vi } from 'vitest';
import { childSignal, deadline, raceAbort, stallWatch, withDeadline } from './abortable';

const never = new Promise<never>(() => {});
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

describe('raceAbort', () => {
  it('answers with the promise when nothing aborts', async () => {
    const c = new AbortController();
    await expect(raceAbort(Promise.resolve(4), c.signal)).resolves.toBe(4);
  });

  it('throws the moment the signal aborts, even over a promise that never settles', async () => {
    const c = new AbortController();
    const p = raceAbort(never, c.signal, 'Export cancelled');
    const expectation = expect(p).rejects.toSatisfy(isAbort);
    c.abort();
    await expectation;
  });

  it('rejects at once on a signal already aborted, and passes a rejection through', async () => {
    const c = new AbortController();
    c.abort();
    await expect(raceAbort(Promise.resolve(1), c.signal)).rejects.toSatisfy(isAbort);
    await expect(raceAbort(Promise.reject(new Error('x')), new AbortController().signal)).rejects.toThrow('x');
  });

  it('is the promise itself without a signal', () => {
    const p = Promise.resolve(1);
    expect(raceAbort(p, undefined)).toBe(p);
  });
});

describe('withDeadline', () => {
  it('answers with the promise when it is in time', async () => {
    vi.useFakeTimers();
    const p = withDeadline(Promise.resolve('ok'), 1000, () => 'late');
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBe('ok');
    vi.useRealTimers();
  });

  it('carries on with the late value past the deadline', async () => {
    vi.useFakeTimers();
    const p = withDeadline(never, 1000, () => 'late');
    await vi.advanceTimersByTimeAsync(1001);
    await expect(p).resolves.toBe('late');
    vi.useRealTimers();
  });

  it('throws the late error past the deadline', async () => {
    vi.useFakeTimers();
    const p = deadline(never, 500, () => new Error('stalled'));
    const expectation = expect(p).rejects.toThrow('stalled');
    await vi.advanceTimersByTimeAsync(501);
    await expectation;
    vi.useRealTimers();
  });

  it('is the promise itself without a deadline', () => {
    expect(withDeadline(never, 0, () => 1)).toBe(never);
  });
});

describe('childSignal', () => {
  it('follows its parent and aborts on its own', () => {
    const parent = new AbortController();
    const a = childSignal(parent.signal);
    expect(a.signal.aborted).toBe(false);
    parent.abort();
    expect(a.signal.aborted).toBe(true);
    const b = childSignal(new AbortController().signal);
    b.abort('stalled');
    expect(b.signal.aborted).toBe(true);
    expect(b.signal.reason).toBe('stalled');
  });
});

describe('stallWatch', () => {
  it('fires once nothing has been said for the window, and never after a touch keeps it alive', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const w = stallWatch(1000, onStall);
    vi.advanceTimersByTime(900);
    w.touch();
    vi.advanceTimersByTime(900);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onStall).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('is silent once stopped', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const w = stallWatch(100, onStall);
    w.stop();
    vi.advanceTimersByTime(500);
    expect(onStall).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
