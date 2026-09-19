import { describe, expect, it } from 'vitest';
import { poolNameSet, refetchKey, refetchSummary, refsToFetch } from './collage-refetch';

const ref = (name: string, assetId?: string) => ({
  name,
  size: 1,
  lastModified: 1,
  ...(assetId ? { assetId } : {}),
});
const connected = (r: { assetId?: string }) =>
  r.assetId?.startsWith('winnow.test/') ? 'winnow.test' : null;

describe('refsToFetch', () => {
  it('fetches every instance-held picture the pool lacks, in cell order', () => {
    const refs = [ref('a.jpg', 'winnow.test/1'), null, ref('b.jpg', 'winnow.test/2')];
    expect(refsToFetch(refs, new Set(), connected).map((t) => t.key)).toEqual([
      'winnow.test/1',
      'winnow.test/2',
    ]);
    expect(refsToFetch(refs, new Set(), connected)[0].sourceId).toBe('winnow.test');
  });

  it('skips what the pool holds, by name and case-blind', () => {
    const refs = [ref('A.JPG', 'winnow.test/1'), ref('b.jpg', 'winnow.test/2')];
    expect(refsToFetch(refs, poolNameSet([{ name: 'a.jpg' }]), connected).map((t) => t.key)).toEqual([
      'winnow.test/2',
    ]);
  });

  it('never names a server that was not connected, nor a local file', () => {
    const refs = [ref('a.jpg', 'elsewhere.test/1'), ref('b.jpg'), ref('c.jpg', 'local/3')];
    expect(refsToFetch(refs, new Set(), connected)).toEqual([]);
  });

  it('asks once per picture, and not again once tried', () => {
    const refs = [ref('a.jpg', 'winnow.test/1'), ref('a.jpg', 'winnow.test/1'), ref('b.jpg', 'winnow.test/2')];
    expect(refsToFetch(refs, new Set(), connected)).toHaveLength(2);
    expect(refsToFetch(refs, new Set(), connected, new Set(['winnow.test/1'])).map((t) => t.key)).toEqual([
      'winnow.test/2',
    ]);
  });
});

describe('refetchKey / poolNameSet', () => {
  it('keys a ref by its asset id only', () => {
    expect(refetchKey(ref('a.jpg'))).toBeNull();
    expect(refetchKey(null)).toBeNull();
    expect(refetchKey(ref('a.jpg', 'h/1'))).toBe('h/1');
  });

  it('ignores empty slots', () => {
    expect([...poolNameSet([null, { name: 'X.jpg' }])]).toEqual(['x.jpg']);
  });
});

describe('refetchSummary', () => {
  it('says what is running first, then what failed, else nothing', () => {
    expect(refetchSummary(new Map())).toBeNull();
    type S = { state: 'fetching' | 'failed'; sourceId: string };
    const failed: S = { state: 'failed', sourceId: 'w' };
    const fetching: S = { state: 'fetching', sourceId: 'w' };
    expect(refetchSummary(new Map([['1', failed]]))).toMatch(/^1 picture could not/);
    expect(refetchSummary(new Map<string, S>([['1', failed], ['2', fetching], ['3', fetching]]))).toBe(
      'Fetching 2 pictures back from w…',
    );
  });
});
