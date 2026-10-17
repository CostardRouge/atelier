import { describe, expect, it } from 'vitest';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { flightIdOf, type AtlasFlightRef } from './atlas-doc';
import { fetchLogsBack, hostOf, winnowIdOn } from './atlas-refetch';

const ref = (winnow?: string): AtlasFlightRef => ({ id: flightIdOf('a'.repeat(64)), name: 'DJI_0001', log: 'a'.repeat(64), size: 1, ...(winnow ? { winnow } : {}) });

describe('logs fetched back from Winnow', () => {
  it('reads the host and the id a flight came from', () => {
    expect(hostOf(ref('winnow.example.com/42'))).toBe('winnow.example.com');
    expect(winnowIdOn(ref('winnow.example.com/42'), 'winnow.example.com')).toBe(42);
    expect(winnowIdOn(ref('winnow.example.com/42'), 'other.host')).toBeNull();
    expect(winnowIdOn(ref('winnow.example.com/x'), 'winnow.example.com')).toBeNull();
    expect(hostOf(ref())).toBeNull();
  });

  it('counts a clip the instance no longer lists, and an instance that does not answer', async () => {
    const gone = { assetsByIds: async () => [] } as unknown as WinnowClient;
    expect(await fetchLogsBack(gone, 'h', [ref('h/1')])).toEqual({ found: 0, gone: 1, changed: 0, failed: 0 });
    const down = { assetsByIds: async () => Promise.reject(new Error('offline')) } as unknown as WinnowClient;
    expect(await fetchLogsBack(down, 'h', [ref('h/1'), ref('other/2')])).toEqual({ found: 0, gone: 0, changed: 0, failed: 1 });
  });
});
