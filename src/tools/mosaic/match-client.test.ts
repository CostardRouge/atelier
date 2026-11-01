import { describe, expect, it } from 'vitest';
import { WORKER_PAST_OPS, matchAnywhere, matchInWorker } from './match-client';

describe('matchInWorker', () => {
  it('hands a big brute force to a worker, keeps a small one here, and never leaves this thread without Worker', () => {
    // No `Worker` in node: always the main thread, whatever the size.
    expect(matchInWorker(1296, 10000, 27)).toBe(false);
    expect(1296 * 10000 * 27).toBeGreaterThan(WORKER_PAST_OPS);
    expect(576 * 600 * 12).toBeLessThan(WORKER_PAST_OPS);
  });

  it('matchAnywhere answers on the main thread here', async () => {
    const cells = new Float32Array([250, 0, 0]);
    const pictures = new Float32Array([0, 0, 255, 255, 0, 0]);
    const m = await matchAnywhere(cells, pictures, 3, 1, 1);
    expect(m.on).toBe('main');
    expect(m.ids[0]).toBe(1);
  });
});
