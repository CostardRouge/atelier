/**
 * The model of his own this DEVICE holds (B4 of `docs/auto-develop.md` §6):
 * ONE `develop-net.onnx` with its `develop-net.json` sidecar, loaded from the
 * run folder `training/` wrote, kept in its own IndexedDB database like a
 * loaded `.dcp` (`raw/profile-vault.ts`) — never on a roll, a preset or a
 * paste, never fetched, never shipped: a model learned from his photographs
 * is his, and `public/` carries none.
 *
 * One model, not a list: loading another replaces it, and the told line says
 * which run answered. Every storage failure degrades to «kept for this visit».
 */

import { useSyncExternalStore } from 'react';
import { readOwnModelSidecar, type OwnModelSidecar } from './own-model';

const DB_NAME = 'atelier-develop-models';
const STORE = 'models';
/** The one row. */
const KEY = 'own';

interface ModelRecord {
  key: typeof KEY;
  /** SHA-256 of the ONNX bytes — the told line's identity, the session cache's key. */
  hash: string;
  fileName: string;
  sidecar: OwnModelSidecar;
  onnx: ArrayBuffer;
  addedAt: number;
}

/** The model as a list or a row shows it — without its bytes. */
export interface OwnModelInfo {
  hash: string;
  fileName: string;
  sidecar: OwnModelSidecar;
  bytes: number;
  addedAt: number;
}

let version = 0;
const listeners = new Set<() => void>();
function changed(): void {
  version += 1;
  for (const l of listeners) l();
}

/** A number that moves whenever the vault does — for a reader to re-read. */
export function useOwnModelVersion(): number {
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
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

/** The record loaded this visit, kept or not: the vault answers from here first. */
let visiting: ModelRecord | null | undefined;

async function readRecord(): Promise<ModelRecord | null> {
  if (visiting !== undefined) return visiting;
  try {
    const db = await openDb();
    const record = await new Promise<ModelRecord | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as ModelRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    visiting = record && readOwnModelSidecar({ kind: 'atelier/develop-net', version: 1, ...sidecarRaw(record.sidecar) }) ? record : null;
    return visiting;
  } catch {
    visiting = null;
    return null;
  }
}

/** The stored sidecar back in the shape the reader checks. */
function sidecarRaw(s: OwnModelSidecar): Record<string, unknown> {
  return { run: s.run, thumb: s.thumb, output: { sliders: s.sliders, ranges: s.ranges } };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export type AddOwnModelResult = { ok: true; info: OwnModelInfo } | { ok: false; reason: string };

/** A model's bytes may be a few megabytes; a file past this is something else. */
const MAX_ONNX_BYTES = 64 * 1024 * 1024;

/**
 * Keep the pair of files the person picked — the `.onnx` and its `.json`
 * sidecar, in either order — and say what it is.
 */
export async function addOwnModel(files: readonly File[]): Promise<AddOwnModelResult> {
  const onnxFile = files.find((f) => /\.onnx$/i.test(f.name)) ?? null;
  const jsonFile = files.find((f) => /\.json$/i.test(f.name)) ?? null;
  if (!onnxFile) return { ok: false, reason: 'pick the model file (develop-net.onnx) with its develop-net.json' };
  if (!jsonFile) return { ok: false, reason: `${onnxFile.name} needs its develop-net.json beside it — pick both` };
  if (onnxFile.size > MAX_ONNX_BYTES) return { ok: false, reason: `${onnxFile.name} is too large to be a develop model` };
  let sidecar: OwnModelSidecar | null;
  try {
    sidecar = readOwnModelSidecar(JSON.parse(await jsonFile.text()));
  } catch {
    sidecar = null;
  }
  if (!sidecar) return { ok: false, reason: `${jsonFile.name} is not the sidecar export-develop writes` };
  let onnx: ArrayBuffer;
  try {
    onnx = await onnxFile.arrayBuffer();
  } catch {
    return { ok: false, reason: `${onnxFile.name} could not be read` };
  }
  if (onnx.byteLength < 64) return { ok: false, reason: `${onnxFile.name} is empty` };
  const hash = hex(await crypto.subtle.digest('SHA-256', onnx));
  const record: ModelRecord = { key: KEY, hash, fileName: onnxFile.name, sidecar, onnx, addedAt: Date.now() };
  visiting = record;
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
  return { ok: true, info: infoOf(record) };
}

function infoOf(r: ModelRecord): OwnModelInfo {
  return { hash: r.hash, fileName: r.fileName, sidecar: r.sidecar, bytes: r.onnx.byteLength, addedAt: r.addedAt };
}

/** The model this device holds, without its bytes; null when none. */
export async function ownModelInfo(): Promise<OwnModelInfo | null> {
  const r = await readRecord();
  return r ? infoOf(r) : null;
}

/** The model with its bytes, for a run; null when none. */
export async function ownModelBytes(): Promise<{ info: OwnModelInfo; onnx: ArrayBuffer } | null> {
  const r = await readRecord();
  return r ? { info: infoOf(r), onnx: r.onnx } : null;
}

/** Take the model out of the vault. */
export async function forgetOwnModel(): Promise<void> {
  visiting = null;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Nothing kept to forget.
  }
  changed();
}
