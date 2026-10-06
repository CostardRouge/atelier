import { afterEach, describe, expect, it, vi } from 'vitest';
import { localPref } from './local-pref';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localPref', () => {
  it('reads the stored value once and tells every reader of a change', () => {
    const store = fakeStorage({ k: 'pixels' });
    vi.stubGlobal('localStorage', store);
    const pref = localPref<'smooth' | 'pixels'>('k', (raw) => (raw === 'pixels' ? 'pixels' : 'smooth'), (v) => v);
    expect(pref.get()).toBe('pixels');
    const a = vi.fn();
    const b = vi.fn();
    pref.subscribe(a);
    const off = pref.subscribe(b);
    off();
    pref.set('smooth');
    expect(pref.get()).toBe('smooth');
    expect(store.map.get('k')).toBe('smooth');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('removes the key when the value encodes to null (the default)', () => {
    const store = fakeStorage({ d: 'roomy' });
    vi.stubGlobal('localStorage', store);
    const pref = localPref<'auto' | 'roomy'>('d', (raw) => (raw === 'roomy' ? 'roomy' : 'auto'), (v) => (v === 'auto' ? null : v));
    pref.set('auto');
    expect(store.map.has('d')).toBe(false);
  });

  it('holds the choice for the session where storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    });
    const pref = localPref<boolean>('f', (raw) => raw === '1', (on) => (on ? '1' : '0'));
    expect(pref.get()).toBe(false);
    pref.set(true);
    expect(pref.get()).toBe(true);
  });
});
