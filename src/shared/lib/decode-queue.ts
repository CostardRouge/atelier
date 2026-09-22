/**
 * A small pool for the decodes a LIST asks for — covers, thumbnails —
 * bounded in how many run at once, and newest first.
 *
 * A scroll over a folder of two hundred photographs used to start two hundred
 * decodes in the same second: every row that entered the viewport asked at
 * once, each decode held a full-size bitmap until its thumbnail was drawn,
 * and the tab paid the memory of all of them together. A pool of a few slots
 * caps that. Newest FIRST because the rows most recently scrolled into view
 * are the ones on screen: a first-in queue would draw the covers the reader
 * has already scrolled past before the ones under the pointer.
 *
 * Pure and DOM-free — `task` is whatever the caller wants run.
 */
export interface DecodeQueue {
  /** Run `task` when a slot is free; resolves or rejects with its result. */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  /** How many tasks are running right now. */
  running(): number;
  /** How many tasks are waiting for a slot. */
  waiting(): number;
}

export function makeDecodeQueue(slots: number): DecodeQueue {
  if (!Number.isInteger(slots) || slots < 1) throw new Error('a decode queue needs at least one slot');
  let running = 0;
  const waiting: Array<() => void> = [];

  const next = () => {
    while (running < slots && waiting.length > 0) {
      // Newest first: what just scrolled into view is what is on screen.
      const start = waiting.pop()!;
      start();
    }
  };

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => {
          running += 1;
          // The slot is freed in the SAME reaction that settles the caller's
          // promise, so the next task has started by the time anyone awaiting
          // this one continues — a `.finally` after the `.then` ran a tick
          // later, and a caller that enqueued on settlement saw a stale count.
          const release = () => {
            running -= 1;
            next();
          };
          task().then(
            (value) => {
              release();
              resolve(value);
            },
            (error: unknown) => {
              release();
              reject(error);
            },
          );
        });
        next();
      });
    },
    running: () => running,
    waiting: () => waiting.length,
  };
}
