import { afterEach, describe, expect, it } from 'vitest';
import { yieldToMain } from './yield-to-main';

describe('yieldToMain without scheduler.yield', () => {
  const g = globalThis as { scheduler?: unknown };
  const saved = g.scheduler;
  afterEach(() => {
    g.scheduler = saved;
  });

  it('resolves every caller when two yield at the same moment', async () => {
    g.scheduler = undefined;
    const both = Promise.all([yieldToMain(), yieldToMain(), yieldToMain()]);
    const timeout = new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500));
    expect(await Promise.race([both.then(() => 'ok' as const), timeout])).toBe('ok');
  });
});
