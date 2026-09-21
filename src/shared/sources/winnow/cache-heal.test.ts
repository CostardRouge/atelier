import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetHealedUrls, healCachedUrl, wasHealed } from './cache-heal';

const URL_A = 'https://winnow.example/api/assets/1/thumb';
const URL_B = 'https://winnow.example/api/assets/2/thumb';

describe('healing a cache entry this origin cannot read', () => {
  beforeEach(() => forgetHealedUrls());

  it('says the entry is worth asking for again when the instance answered', async () => {
    const run = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
    expect(await healCachedUrl(URL_A, run)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('says no when asking past the cache changes nothing — offline, 401, 404', async () => {
    expect(await healCachedUrl(URL_A, () => Promise.reject(new TypeError('failed')))).toBe(false);
    expect(await healCachedUrl(URL_B, () => Promise.resolve(new Response('', { status: 401 })))).toBe(false);
  });

  it('heals one URL once a session, however many tiles ask', async () => {
    const run = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
    const [a, b, c] = await Promise.all([
      healCachedUrl(URL_A, run),
      healCachedUrl(URL_A, run),
      healCachedUrl(URL_A, run),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not ask again after a failure either — that is not what a cache does', async () => {
    const run = vi.fn(() => Promise.reject(new TypeError('failed')));
    expect(await healCachedUrl(URL_A, run)).toBe(false);
    expect(await healCachedUrl(URL_A, run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(wasHealed(URL_A)).toBe(true);
    expect(wasHealed(URL_B)).toBe(false);
  });
});
