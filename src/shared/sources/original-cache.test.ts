import { afterEach, describe, expect, it } from 'vitest';
import {
  dropHeldOriginals,
  heldOriginal,
  heldOriginalBytes,
  heldOriginalKeys,
  heldCeilingBytes,
  heldVersion,
  holdOriginal,
  overrideHeldCeiling,
} from './original-cache';
import { DEFAULT_HELD_CEILING } from './held-budget';

const file = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name);

afterEach(() => {
  overrideHeldCeiling(null);
  dropHeldOriginals();
});

describe('the session cache is bounded', () => {
  it('lets the least recently used go when a hold crosses the ceiling, and says so', () => {
    overrideHeldCeiling(250);
    const before = heldVersion();
    holdOriginal('w/1', file('a', 100));
    holdOriginal('w/2', file('b', 100));
    // A read is a use: `w/1` is now the more recent of the two.
    expect(heldOriginal('w/1')?.name).toBe('a');
    holdOriginal('w/3', file('c', 100));
    expect(heldOriginal('w/2')).toBeNull();
    expect(heldOriginal('w/1')?.name).toBe('a');
    expect(heldOriginal('w/3')?.name).toBe('c');
    expect(heldOriginalBytes()).toBe(200);
    expect(heldOriginalKeys()).toEqual(['w/3', 'w/1']);
    expect(heldVersion()).toBeGreaterThan(before);
  });

  it('keeps a single file over the ceiling — it is the one being worked on', () => {
    overrideHeldCeiling(50);
    holdOriginal('w/1', file('big', 100));
    expect(heldOriginal('w/1')?.name).toBe('big');
    holdOriginal('w/2', file('bigger', 120));
    expect(heldOriginal('w/1')).toBeNull();
    expect(heldOriginal('w/2')?.name).toBe('bigger');
  });

  it('takes the device’s ceiling where nothing overrides it', () => {
    expect(heldCeilingBytes()).toBeGreaterThanOrEqual(256 * 1024 * 1024);
    expect(heldCeilingBytes()).toBeLessThanOrEqual(1024 * 1024 * 1024);
    overrideHeldCeiling(null);
    // In node there is no `navigator.deviceMemory`: the default.
    expect(heldCeilingBytes()).toBe(DEFAULT_HELD_CEILING);
  });
});
