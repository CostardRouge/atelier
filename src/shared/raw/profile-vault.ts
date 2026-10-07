/**
 * The camera profiles a person LOADED (C8 of `docs/camera-profiles.md`): his
 * own `.dcp` files, kept on THIS device in their own IndexedDB database under
 * the SHA-256 of their bytes — the vault rule a purchased `.cube` follows
 * (`media-pipeline.md`): a picture stores a REFERENCE (`RawProfile.dcp`, the
 * hash and the name), never the profile, so a roll synced to a Winnow carries
 * no byte of a file whose licence is his to judge, and a profile whose
 * `ProfileEmbedPolicy` says «never embed» is never copied anywhere.
 *
 * Atelier ships no profile and fetches none. A picture whose profile is not
 * in this device's vault keeps its stored matrix (resolved when it was
 * chosen) and loses only the profile's tables, said where it is drawn.
 *
 * Every storage failure degrades to «not kept»: the profile is used for the
 * visit and asked for again next time.
 */

import { useSyncExternalStore } from 'react';
import { readDcp } from '../exif/dcp';
import type { DngProfile } from '../exif/dng-profile';

const DB_NAME = 'atelier-camera-profiles';
const STORE = 'profiles';

interface ProfileRecord {
  hash: string;
  name: string;
  fileName: string;
  bytes: ArrayBuffer;
  addedAt: number;
}

/** One profile in the vault, as a list shows it. */
export interface VaultProfile {
  hash: string;
  name: string;
  fileName: string;
  addedAt: number;
  /** `ProfileEmbedPolicy`: 0 copy · 1 embed if used · 2 never embed · 3 free; null when unstated. */
  embedPolicy: number | null;
}

let version = 0;
const listeners = new Set<() => void>();
function changed(): void {
  version += 1;
  for (const l of listeners) l();
}

/** A number that moves whenever the vault does — for a list to re-read. */
export function useVaultVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'hash' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function readRecord(hash: string): Promise<ProfileRecord | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(hash);
      req.onsuccess = () => resolve((req.result as ProfileRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function allRecords(): Promise<ProfileRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as ProfileRecord[] | undefined) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Profiles read this visit, by hash — a decode asks per picture, the vault answers once. */
const parsed = new Map<string, DngProfile>();
/** Profiles loaded this visit that the device would not keep: still usable until the tab closes. */
const visiting = new Map<string, ProfileRecord>();

export type AddResult = { ok: true; hash: string; name: string } | { ok: false; reason: string };

/** Read a `.dcp` the person picked, keep it, and say what it is. */
export async function addDcp(file: File): Promise<AddResult> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { ok: false, reason: `${file.name} could not be read` };
  }
  const read = readDcp(bytes, file.name);
  if (!read) return { ok: false, reason: `${file.name} is not a camera profile (.dcp) with a colour matrix` };
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes));
  const record: ProfileRecord = { hash, name: read.name, fileName: file.name, bytes, addedAt: Date.now() };
  parsed.set(hash, read.profile);
  visiting.set(hash, record);
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Not kept: usable for this visit only.
  }
  changed();
  return { ok: true, hash, name: read.name };
}

/** Every profile in the vault, newest first. */
export async function listDcps(): Promise<VaultProfile[]> {
  const kept = await allRecords();
  const byHash = new Map(kept.map((r) => [r.hash, r]));
  for (const [hash, r] of visiting) if (!byHash.has(hash)) byHash.set(hash, r);
  return [...byHash.values()]
    .map((r) => ({
      hash: r.hash,
      name: r.name,
      fileName: r.fileName,
      addedAt: r.addedAt,
      embedPolicy: profileOf(r)?.embedPolicy ?? null,
    }))
    .sort((a, b) => b.addedAt - a.addedAt);
}

function profileOf(record: ProfileRecord): DngProfile | null {
  const known = parsed.get(record.hash);
  if (known) return known;
  const read = readDcp(record.bytes, record.fileName);
  if (read) parsed.set(record.hash, read.profile);
  return read?.profile ?? null;
}

/** The profile under `hash`, read; null where this device does not hold it. */
export async function dcpProfile(hash: string): Promise<DngProfile | null> {
  const known = parsed.get(hash);
  if (known) return known;
  const record = visiting.get(hash) ?? (await readRecord(hash));
  return record ? profileOf(record) : null;
}

/** Take a profile out of the vault; pictures that chose it keep their matrix and lose its tables. */
export async function forgetDcp(hash: string): Promise<void> {
  parsed.delete(hash);
  visiting.delete(hash);
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Nothing kept to forget.
  }
  changed();
}
