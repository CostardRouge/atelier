import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetBrowseState,
  readBrowseState,
  writeBrowseState,
  type BrowseState,
} from './browse-state';

const KEY = 'atelier.sources.winnow.browse.v1';

const place = (over: Partial<BrowseState> = {}): BrowseState => ({
  view: 'day',
  filter: { mediaType: 'video', ext: 'mp4', device: 'DJI Mini 4 Pro' },
  month: '2025-07',
  day: '2025-07-09',
  sessionId: null,
  fidelity: 'proxy',
  ...over,
});

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

describe('the browser\'s remembered place', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('starts with nothing to restore', () => {
    expect(readBrowseState('winnow.example')).toBeNull();
  });

  it('round-trips a place', () => {
    writeBrowseState('winnow.example', place());
    expect(readBrowseState('winnow.example')).toEqual(place());
  });

  it('keeps instances apart', () => {
    writeBrowseState('a.example', place({ month: '2025-07' }));
    writeBrowseState('b.example', place({ month: '2024-01', view: 'session', sessionId: 9 }));
    expect(readBrowseState('a.example')?.month).toBe('2025-07');
    expect(readBrowseState('b.example')).toMatchObject({ month: '2024-01', sessionId: 9 });
  });

  it('rejects a month that is not one — it would build a calendar of nothing', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'a.example': { ...place(), month: 'banana' } }));
    expect(readBrowseState('a.example')).toBeNull();
  });

  it('drops a malformed day rather than the whole place', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'a.example': { ...place(), day: '9 July' } }));
    expect(readBrowseState('a.example')).toMatchObject({ month: '2025-07', day: null });
  });

  it('keeps only filter values it recognises', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        'a.example': { ...place(), filter: { mediaType: 'audio', ext: '', device: 'DJI', junk: 1 } },
      }),
    );
    expect(readBrowseState('a.example')?.filter).toEqual({ device: 'DJI' });
  });

  it('survives garbage in storage', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readBrowseState('a.example')).toBeNull();
    // …and writing over it still works.
    writeBrowseState('a.example', place());
    expect(readBrowseState('a.example')?.month).toBe('2025-07');
  });

  it('degrades to no memory when storage is unavailable', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => writeBrowseState('a.example', place())).not.toThrow();
    expect(readBrowseState('a.example')).toBeNull();
  });

  it('forgets one instance without touching the others', () => {
    writeBrowseState('a.example', place());
    writeBrowseState('b.example', place({ month: '2024-01' }));
    forgetBrowseState('a.example');
    expect(readBrowseState('a.example')).toBeNull();
    expect(readBrowseState('b.example')?.month).toBe('2024-01');
  });
});
