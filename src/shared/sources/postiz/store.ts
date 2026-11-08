/**
 * The Postiz this browser has connected (lab 12) — ONE, kept locally like a
 * Winnow connection: the API's address, the API key the person pasted (a key
 * to their own scheduler, revoked in Postiz's Settings, dropped here by
 * Forget), the channels it listed, the one Recap publishes to, the
 * collaborator Recap proposes, and the person's rhythm (`rhythm.ts`).
 *
 * `localStorage`: one small record, read synchronously. No request is made by
 * this module — connecting is the person's act on `#/sources`.
 */

import { readChannels, type PostizChannel } from './client';
import { DEFAULT_RHYTHM, readRhythm, type Rhythm } from './rhythm';

export interface PostizConnection {
  /** The public API's base, as found on connect: `https://postiz.example/api/public/v1`. */
  apiBase: string;
  apiKey: string;
  channels: PostizChannel[];
  /** The channel Recap publishes to; null until chosen. */
  channelId: string | null;
  /** An Instagram handle Recap offers as collaborator (without @), or ''. */
  collaborator: string;
  rhythm: Rhythm;
  connectedAt: number;
}

const KEY = 'atelier.sources.postiz.v1';
let cache: PostizConnection | null | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readConnection(raw: unknown): PostizConnection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.apiBase !== 'string' || typeof r.apiKey !== 'string' || !r.apiBase || !r.apiKey) return null;
  const channels = readChannels(r.channels);
  const channelId = typeof r.channelId === 'string' && channels.some((c) => c.id === r.channelId) ? r.channelId : null;
  return {
    apiBase: r.apiBase,
    apiKey: r.apiKey,
    channels,
    channelId,
    collaborator: typeof r.collaborator === 'string' ? r.collaborator.replace(/^@/, '').slice(0, 60) : '',
    rhythm: readRhythm(r.rhythm),
    connectedAt: typeof r.connectedAt === 'number' ? r.connectedAt : 0,
  };
}

export function getPostiz(): PostizConnection | null {
  if (cache !== undefined) return cache;
  try {
    cache = readConnection(JSON.parse(storage()?.getItem(KEY) ?? 'null'));
  } catch {
    cache = null;
  }
  return cache;
}

function write(next: PostizConnection | null): void {
  cache = next;
  try {
    if (next) storage()?.setItem(KEY, JSON.stringify(next));
    else storage()?.removeItem(KEY);
  } catch {
    // A private window keeps it for this visit only.
  }
  for (const l of listeners) l();
}

export function putPostiz(conn: PostizConnection): void {
  write(readConnection(conn));
}

/** A change to the kept connection (the channel, the rhythm, the collaborator…); nothing when none is kept. */
export function updatePostiz(patch: Partial<Omit<PostizConnection, 'apiBase' | 'apiKey'>>): void {
  const cur = getPostiz();
  if (cur) write(readConnection({ ...cur, ...patch }));
}

export function forgetPostiz(): void {
  write(null);
}

export function subscribePostiz(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The channel Recap publishes to: the chosen one, else the only one. */
export function publishChannel(conn: PostizConnection | null): PostizChannel | null {
  if (!conn) return null;
  const live = conn.channels.filter((c) => !c.disabled);
  return live.find((c) => c.id === conn.channelId) ?? (live.length === 1 ? live[0] : null);
}

export { DEFAULT_RHYTHM };
