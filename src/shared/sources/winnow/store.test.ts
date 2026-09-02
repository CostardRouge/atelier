import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getWinnowConnection,
  listWinnowConnections,
  putWinnowConnection,
  removeWinnowConnection,
  resetWinnowConnectionsForTests,
  subscribeWinnowConnections,
  type WinnowConnection,
} from './store';
import { listSources, sourceById } from '../source';
import { readBrowseState, writeBrowseState } from './browse-state';

const conn = (id = 'winnow.example'): WinnowConnection => ({
  id,
  baseUrl: `https://${id}`,
  auth: { mode: 'cookie' },
  capabilities: null,
  connectedAt: 1000,
});

/** A Storage stand-in: node has no localStorage. */
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

describe('the Winnow connection store', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    resetWinnowConnectionsForTests();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    resetWinnowConnectionsForTests();
  });

  it('starts empty and mirrors nothing into the source list', () => {
    expect(listWinnowConnections()).toEqual([]);
    expect(listSources().map((s) => s.id)).toEqual(['local']);
  });

  it('persists a connection and exposes it as a source', () => {
    putWinnowConnection(conn());
    resetWinnowConnectionsForTests();
    expect(getWinnowConnection('winnow.example')?.baseUrl).toBe('https://winnow.example');
    expect(sourceById('winnow.example')).toMatchObject({ kind: 'winnow', label: 'winnow.example' });
  });

  it('connecting again replaces rather than duplicates', () => {
    putWinnowConnection(conn());
    putWinnowConnection({ ...conn(), connectedAt: 2000 });
    expect(listWinnowConnections()).toHaveLength(1);
    expect(listWinnowConnections()[0].connectedAt).toBe(2000);
  });

  it('removing a connection removes the source', () => {
    putWinnowConnection(conn());
    removeWinnowConnection('winnow.example');
    expect(sourceById('winnow.example')).toBeNull();
  });

  it('forgets where you were looking when the connection goes', () => {
    putWinnowConnection(conn());
    writeBrowseState('winnow.example', {
      view: 'day',
      filter: {},
      month: '2025-07',
      day: null,
      sessionId: null,
      fidelity: 'proxy',
    });
    removeWinnowConnection('winnow.example');
    // Reconnecting the same host later must not reopen on a month chosen for
    // a library it is no longer browsing.
    expect(readBrowseState('winnow.example')).toBeNull();
  });

  it('refuses to register a remote source called local', () => {
    expect(() => putWinnowConnection(conn('local'))).toThrow(/local/);
  });

  it('reports capabilities honestly — unknown means false', () => {
    putWinnowConnection(conn());
    expect(sourceById('winnow.example')?.capabilities).toEqual({
      media: true,
      documents: false,
      scheduling: false,
    });
  });

  it('survives garbage in storage', () => {
    localStorage.setItem('atelier.sources.winnow.v1', '{not json');
    expect(listWinnowConnections()).toEqual([]);
    localStorage.setItem('atelier.sources.winnow.v1', JSON.stringify([{ nope: 1 }, conn()]));
    resetWinnowConnectionsForTests();
    expect(listWinnowConnections()).toHaveLength(1);
  });

  it('wakes subscribers on change', () => {
    let n = 0;
    const off = subscribeWinnowConnections(() => n++);
    putWinnowConnection(conn());
    off();
    putWinnowConnection(conn('other.example'));
    expect(n).toBe(1);
  });
});
