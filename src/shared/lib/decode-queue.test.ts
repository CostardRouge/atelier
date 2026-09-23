import { describe, expect, it } from 'vitest';
import { makeDecodeQueue } from './decode-queue';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('makeDecodeQueue', () => {
  it('runs at most `slots` tasks at once and starts the rest as slots free up', async () => {
    const q = makeDecodeQueue(2);
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];
    const results = gates.map((g, i) =>
      q.enqueue(() => {
        started.push(i);
        return g.promise;
      }),
    );
    expect(q.running()).toBe(2);
    expect(q.waiting()).toBe(1);
    expect(started).toEqual([0, 1]);

    gates[0].resolve('a');
    await results[0];
    expect(q.running()).toBe(2);
    expect(q.waiting()).toBe(0);
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve('b');
    gates[2].resolve('c');
    await expect(Promise.all(results)).resolves.toEqual(['a', 'b', 'c']);
    expect(q.running()).toBe(0);
  });

  it('starts the most recently queued task first when a slot frees', async () => {
    const q = makeDecodeQueue(1);
    const gate = deferred<void>();
    const order: string[] = [];
    void q.enqueue(() => gate.promise);
    const later = ['second', 'third', 'fourth'].map((name) =>
      q.enqueue(async () => {
        order.push(name);
      }),
    );
    expect(q.waiting()).toBe(3);
    gate.resolve();
    await Promise.all(later);
    expect(order).toEqual(['fourth', 'third', 'second']);
  });

  it('frees the slot when a task rejects, and passes the rejection on', async () => {
    const q = makeDecodeQueue(1);
    const failing = q.enqueue(() => Promise.reject(new Error('undecodable')));
    const after = q.enqueue(async () => 'fine');
    await expect(failing).rejects.toThrow('undecodable');
    await expect(after).resolves.toBe('fine');
    expect(q.running()).toBe(0);
  });

  it('refuses a pool with no slot', () => {
    expect(() => makeDecodeQueue(0)).toThrow();
  });
});
