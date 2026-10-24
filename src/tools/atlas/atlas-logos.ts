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
import { findGround, hasTransparency, keyOut } from './atlas-logo-key';
import { drawableSvg, makerKey, svgWithViewBox, withSvgNamespace } from './atlas-sticker';
import { base64ToBytes, bytesToBase64, type AtlasFileLogo } from './atlas-file';

const DB_NAME = 'atelier-atlas-logos';
const STORE = 'logos';
const MAX_BYTES = 4 * 1024 * 1024;

interface LogoRecord {
  maker: string;
  fileName: string;
  type: string;
  bytes: ArrayBuffer;
  addedAt: number;
  /** The author kept the plain ground the file was saved on (absent: it is taken out). */
  keepGround?: boolean;
}

/** A logo ready to draw. */
export interface AtlasLogo {
  maker: string;
  fileName: string;
  image: HTMLImageElement;
  /** Width over height. */
  ratio: number;
  /** A file with no transparency and no ground to take out: in the ink it is a block. */
  opaque: boolean;
  /** The file stood on a plain ground (or a baked checkerboard) that can be taken out. */
  ground: boolean;
  /** That ground is kept, as the author asked. */
  keepGround: boolean;
}

let logos: ReadonlyMap<string, AtlasLogo> = new Map();
/** The files behind them, by maker key — so a choice made on one works even where IndexedDB does not. */
const records = new Map<string, LogoRecord>();
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

/** The largest side a raster logo is worked at — far more than a sticker ever draws. */
const WORK_SIDE = 2048;

async function imageOf(blob: Blob): Promise<HTMLImageElement | null> {
  const image = new Image();
  const url = URL.createObjectURL(blob);
  image.src = url;
  try {
    await image.decode();
    // The URL stays alive with the image: a canvas draws an SVG from it at every size asked.
    return image;
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * An SVG whose file states no size and no viewBox, measured on the page:
 * drawn hidden in the document, its content's box becomes its viewBox.
 */
function measuredSvg(text: string): string | null {
  if (typeof document === 'undefined') return null;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden';
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
    holder.appendChild(document.importNode(svg, true));
    document.body.appendChild(holder);
    const box = (holder.firstChild as SVGGraphicsElement).getBBox();
    return box.width > 0 && box.height > 0 ? svgWithViewBox(text, box) : null;
  } catch {
    return null;
  } finally {
    holder.remove();
  }
}

/**
 * A raster logo with its plain ground taken out (`atlas-logo-key.ts`),
 * unless the author keeps it: a new PNG image, or the decoded one as it is.
 */
async function keyed(image: HTMLImageElement, keep: boolean): Promise<{ image: HTMLImageElement; ground: boolean; clear: boolean }> {
  const k = Math.min(1, WORK_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * k));
  const h = Math.max(1, Math.round(image.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { image, ground: false, clear: false };
  ctx.drawImage(image, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h);
  const clear = hasTransparency(pixels.data);
  const ground = clear ? null : findGround(pixels.data, w, h);
  if (!ground || keep) return { image, ground: !!ground, clear };
  pixels.data.set(keyOut(pixels.data, ground));
  ctx.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  const out = blob ? await imageOf(blob) : null;
  if (!out) return { image, ground: true, clear };
  URL.revokeObjectURL(image.src);
  return { image: out, ground: true, clear: true };
}

/** Decode a record into something a canvas draws at any size; null when it is no picture. */
async function decode(r: LogoRecord): Promise<AtlasLogo | null> {
  const keep = !!r.keepGround;
  if (isSvg(r)) {
    const raw = withSvgNamespace(new TextDecoder().decode(r.bytes));
    const sized = drawableSvg(raw) ?? drawableSvg(measuredSvg(raw) ?? '');
    if (!sized) return null;
    const image = await imageOf(new Blob([sized.text], { type: 'image/svg+xml' }));
    if (!image) return null;
    // An SVG keeps its own transparency: nothing to take out.
    return { maker: r.maker, fileName: r.fileName, image, ratio: clampRatio(sized.ratio), opaque: false, ground: false, keepGround: false };
  }
  const decoded = await imageOf(new Blob([r.bytes], { type: r.type || 'image/png' }));
  if (!decoded || !decoded.naturalWidth || !decoded.naturalHeight) return null;
  const ratio = decoded.naturalWidth / decoded.naturalHeight;
  const out = await keyed(decoded, keep);
  return { maker: r.maker, fileName: r.fileName, image: out.image, ratio: clampRatio(ratio), opaque: !out.clear, ground: out.ground, keepGround: keep && out.ground };
}

const clampRatio = (ratio: number) => Math.max(0.2, Math.min(12, ratio));

function release(logo: AtlasLogo | undefined): void {
  if (logo?.image.src.startsWith('blob:')) URL.revokeObjectURL(logo.image.src);
}

/** Read every kept logo once per visit. */
function load(): Promise<void> {
  loading ??= (async () => {
    const next = new Map<string, AtlasLogo>(logos);
    for (const r of await allRecords()) {
      if (next.has(r.maker)) continue;
      records.set(r.maker, r);
      const logo = await decode(r);
      if (logo) next.set(r.maker, logo);
    }
    publish(next);
  })();
  return loading;
}

/** Resolves once the logos this device keeps are decoded and published (never rejects). */
export function logosLoaded(): Promise<void> {
  return load().catch(() => undefined);
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
  if (!logo) return { ok: false, reason: `${file.name} is not a picture this browser can draw (an SVG, a PNG, a WebP or a JPEG).` };
  await load();
  records.set(record.maker, record);
  const next = new Map(logos);
  release(next.get(record.maker));
  next.set(record.maker, logo);
  publish(next);
  await write((store) => store.put(record));
  return { ok: true };
}

/** Keep or take out the plain ground `maker`'s logo was saved on. */
export async function setLogoGround(maker: string, keep: boolean): Promise<void> {
  const key = makerKey(maker);
  const record = records.get(key);
  if (!record) return;
  const next: LogoRecord = { ...record, keepGround: keep };
  records.set(key, next);
  const logo = await decode(next);
  if (!logo) return;
  const map = new Map(logos);
  release(map.get(key));
  map.set(key, logo);
  publish(map);
  await write((store) => store.put(next));
}

/** Take `maker`'s logo away: the sticker writes its name again. */
export async function forgetLogo(maker: string): Promise<void> {
  const key = makerKey(maker);
  records.delete(key);
  const next = new Map(logos);
  release(next.get(key));
  next.delete(key);
  publish(next);
  await write((store) => store.delete(key));
}

/** Every logo kept on this device, as a backup file carries them. */
export async function exportLogos(): Promise<AtlasFileLogo[]> {
  await load();
  return [...records.values()].map((r) => ({
    maker: r.maker,
    fileName: r.fileName,
    type: r.type,
    data: bytesToBase64(r.bytes),
    ...(r.keepGround ? { keepGround: true } : {}),
  }));
}

/**
 * Logos from a backup file, for the makers this device keeps none of — a logo
 * already here wins. Each is decoded first like an import from disk, so a
 * file that is no picture is left out. Answers how many were kept.
 */
export async function importLogos(incoming: readonly AtlasFileLogo[]): Promise<number> {
  await load();
  let kept = 0;
  const next = new Map(logos);
  for (const l of incoming) {
    const maker = makerKey(l.maker);
    if (!maker || records.has(maker)) continue;
    let bytes: ArrayBuffer;
    try {
      bytes = base64ToBytes(l.data);
    } catch {
      continue;
    }
    if (bytes.byteLength > MAX_BYTES) continue;
    const record: LogoRecord = { maker, fileName: l.fileName, type: l.type, bytes, addedAt: Date.now(), ...(l.keepGround ? { keepGround: true } : {}) };
    const logo = await decode(record);
    if (!logo) continue;
    records.set(maker, record);
    next.set(maker, logo);
    await write((store) => store.put(record));
    kept += 1;
  }
  if (kept) publish(next);
  return kept;
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
