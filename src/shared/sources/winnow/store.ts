/**
 * The Winnow instances this browser has connected — persisted locally.
 *
 * A connection is a base URL and an auth mode, nothing more: in cookie mode
 * there is no secret to keep, and the session itself lives in Winnow's own
 * cookie. What IS kept is the capabilities sheet read at connect time, so the
 * UI can say what an instance can do without a request.
 *
 * `localStorage`, not IndexedDB: a handful of small records, read
 * synchronously at boot to populate the source list. Storage failure degrades
 * to in-memory, like every other store here. No request is made by this
 * module — connecting is the user's act (`#/connect`).
 */

import { LOCAL_SOURCE, setRemoteSources, type SourceInfo } from '../source';
import { forgetBrowseState } from './browse-state';
import type { WinnowAuth, WinnowCapabilities } from './client';

export interface WinnowConnection {
  /** The host — also the source id documents carry. */
  id: string;
  baseUrl: string;
  auth: WinnowAuth;
  /** What the instance said it could do, the last time it was asked. */
  capabilities: WinnowCapabilities | null;
  connectedAt: number;
}

const KEY = 'atelier.sources.winnow.v1';

let cache: WinnowConnection[] | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isConnection(v: unknown): v is WinnowConnection {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.baseUrl === 'string' &&
    typeof c.auth === 'object' &&
    c.auth !== null &&
    typeof (c.auth as { mode?: unknown }).mode === 'string'
  );
}

function load(): WinnowConnection[] {
  if (cache) return cache;
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(storage()?.getItem(KEY) ?? '[]');
  } catch {
    parsed = [];
  }
  cache = Array.isArray(parsed) ? parsed.filter(isConnection) : [];
  mirror();
  return cache;
}

function save(next: WinnowConnection[]) {
  cache = next;
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* in-memory only for this session */
  }
  mirror();
  for (const fn of listeners) fn();
}

/** Keep the source registry in step — on every read and every write. */
function mirror() {
  setRemoteSources((cache ?? []).map(toSourceInfo));
}

export function toSourceInfo(c: WinnowConnection): SourceInfo {
  const caps = c.capabilities;
  return {
    id: c.id,
    label: c.id,
    kind: 'winnow',
    capabilities: {
      media: true,
      documents: caps?.documents.bucket ?? false,
      scheduling: caps?.scheduling.reminders ?? false,
    },
  };
}

export function listWinnowConnections(): WinnowConnection[] {
  return load();
}

export function getWinnowConnection(id: string): WinnowConnection | null {
  return load().find((c) => c.id === id) ?? null;
}

/** Add or replace (same id) — connecting twice refreshes, never duplicates. */
export function putWinnowConnection(conn: WinnowConnection): void {
  if (conn.id === LOCAL_SOURCE.id) throw new Error('"local" is not a remote source.');
  save([...load().filter((c) => c.id !== conn.id), conn]);
}

export function removeWinnowConnection(id: string): void {
  // Where you were looking in it goes with it — otherwise reconnecting the
  // same host later reopens on a month chosen for a library it no longer is.
  forgetBrowseState(id);
  save(load().filter((c) => c.id !== id));
}

/** For `useSyncExternalStore`: re-render when a connection is added/removed. */
export function subscribeWinnowConnections(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam: forget the cached list so the next read hits storage again. */
export function resetWinnowConnectionsForTests(): void {
  cache = null;
  setRemoteSources([]);
}
