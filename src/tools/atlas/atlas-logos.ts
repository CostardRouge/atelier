/**
 * The makers' LOGOS the gear sticker draws — one per maker, imported by the
 * person from their own files and kept on THIS device in their own IndexedDB
 * database. Atelier ships none: a maker's logo is its trademark, so it never
 * enters the repository, the site, a preset or the settings; the sticker
 * writes the maker's name in the heavy weight wherever no logo is kept.
 *
 * Every storage failure degrades to «not kept»: the logo is drawn for the
 * visit and asked for again next time.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { drawableSvg, makerKey } from './atlas-sticker';

const DB_NAME = 'atelier-atlas-logos';
const STORE = 'logos';
const MAX_BYTES = 4 * 1024 * 1024;

interface LogoRecord {
  maker: string;
  fileName: string;
  type: string;
  bytes: ArrayBuffer;
  addedAt: number;
}

/** A logo ready to draw. */
export interface AtlasLogo {
  maker: string;
  fileName: string;
  image: HTMLImageElement;
  /** Width over height. */
  ratio: number;
  /** A file with no transparency (a JPEG): in the ink it is a block. */
  opaque: boolean;
}

let logos: ReadonlyMap<string, AtlasLogo> = new Map();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
function publish(next: ReadonlyMap<string, AtlasLogo>): void {
  logos = next;
  for (const l of listeners) l();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'maker' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function allRecords(): Promise<LogoRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as LogoRecord[] | undefined) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function write(fn: (store: IDBObjectStore) => void): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Not kept: drawn for this visit only.
  }
}

const isSvg = (r: Pick<LogoRecord, 'type' | 'fileName'>) => /svg/i.test(r.type) || /\.svg$/i.test(r.fileName);
const isJpeg = (r: Pick<LogoRecord, 'type' | 'fileName'>) => /jpe?g/i.test(r.type) || /\.jpe?g$/i.test(r.fileName);

/** Decode a record into something a canvas draws at any size; null when it is no picture. */
async function decode(r: LogoRecord): Promise<AtlasLogo | null> {
  let blob: Blob;
  let ratio: number | null = null;
  if (isSvg(r)) {
    const sized = drawableSvg(new TextDecoder().decode(r.bytes));
    if (!sized) return null;
    blob = new Blob([sized.text], { type: 'image/svg+xml' });
    ratio = sized.ratio;
  } else {
    blob = new Blob([r.bytes], { type: r.type || 'image/png' });
  }
  const image = new Image();
  const url = URL.createObjectURL(blob);
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  // The URL stays alive with the image: a canvas draws an SVG from it at every size asked.
  ratio ??= image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : null;
  if (!ratio) return null;
  return { maker: r.maker, fileName: r.fileName, image, ratio: Math.max(0.2, Math.min(12, ratio)), opaque: isJpeg(r) };
}

function release(logo: AtlasLogo | undefined): void {
  if (logo?.image.src.startsWith('blob:')) URL.revokeObjectURL(logo.image.src);
}

/** Read every kept logo once per visit. */
function load(): Promise<void> {
  loading ??= (async () => {
    const records = await allRecords();
    const next = new Map<string, AtlasLogo>(logos);
    for (const r of records) {
      if (next.has(r.maker)) continue;
      const logo = await decode(r);
      if (logo) next.set(r.maker, logo);
    }
    publish(next);
  })();
  return loading;
}

export type AddLogoResult = { ok: true } | { ok: false; reason: string };

/** Keep `file` as `maker`'s logo, in place of any other. */
export async function addLogo(maker: string, file: File): Promise<AddLogoResult> {
  if (file.size > MAX_BYTES) return { ok: false, reason: `${file.name} is too large for a logo (4 MB at most).` };
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { ok: false, reason: `${file.name} could not be read.` };
  }
  const record: LogoRecord = { maker: makerKey(maker), fileName: file.name, type: file.type, bytes, addedAt: Date.now() };
  const logo = await decode(record);
  if (!logo) return { ok: false, reason: `${file.name} is not a picture this browser can draw (an SVG with a size, a PNG, a WebP or a JPEG).` };
  await load();
  const next = new Map(logos);
  release(next.get(record.maker));
  next.set(record.maker, logo);
  publish(next);
  await write((store) => store.put(record));
  return { ok: true };
}

/** Take `maker`'s logo away: the sticker writes its name again. */
export async function forgetLogo(maker: string): Promise<void> {
  const key = makerKey(maker);
  const next = new Map(logos);
  release(next.get(key));
  next.delete(key);
  publish(next);
  await write((store) => store.delete(key));
}

/** The logos kept on this device, by maker key — read once, then live. */
export function useAtlasLogos(): ReadonlyMap<string, AtlasLogo> {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => logos,
    () => logos,
  );
}
