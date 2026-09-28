/**
 * The still decoders this suite SHIPS, for the formats a browser refuses —
 * JPEG XL (`jxl-oxide-wasm`) and HEIF (`libheif-js`: `.heic`, `.heif`, a
 * Sony or Canon `.HIF`). Reached only through `still-decode.ts`, and only
 * once the browser's own decoder has said no: Safari reads both natively and
 * never loads a byte of this.
 *
 * Dynamically imported, and every byte of it served from our own origin — a
 * separate chunk and a `.wasm` asset in `dist/` — so a page load contacts no
 * third party and the entry bundle pays nothing (`local-first.md`).
 *
 * What each hands back is what the rest of the door already knows how to
 * size: a JPEG XL is rendered to a PNG — 16 bits a channel where the file
 * had them, its ICC profile inside — which the browser then decodes AT the
 * size asked, exactly as a JPEG; a HEIF is decoded whole to RGBA (libheif
 * applies the file's rotation and mirror) and bounded after. Neither decoder
 * can decode at a size, so the whole picture exists once, briefly, here.
 *
 * The HEIF module keeps a heap the size of the biggest picture it decoded and
 * never gives it back, so it is let go after a few idle seconds and on a
 * hidden tab — the RAW decoder's rule (`device-memory.md`).
 */

import jxlWasmUrl from 'jxl-oxide-wasm/module.wasm?url';
import { readPngSamples, type PngSamples } from './png-read';
import type { PixelSize } from './still-fit';
import type { StillFormat } from './still-format';

/** A decoded still: a blob the browser draws itself, or RGBA already upright. */
export type WasmStill = { kind: 'blob'; blob: Blob } | { kind: 'pixels'; image: ImageData };

// ── JPEG XL ────────────────────────────────────────────────────────────────

type JxlModule = typeof import('jxl-oxide-wasm');

let jxl: Promise<JxlModule> | null = null;

function loadJxl(): Promise<JxlModule> {
  jxl ??= import('jxl-oxide-wasm').then(async (mod) => {
    await mod.default({ module_or_path: jxlWasmUrl });
    return mod;
  });
  jxl.catch(() => (jxl = null));
  return jxl;
}

/** Feed `blob` to a fresh decoder, a chunk at a time, until `enough` says stop. */
async function feedJxl(mod: JxlModule, blob: Blob, enough: (img: InstanceType<JxlModule['JxlImage']>) => boolean) {
  const img = new mod.JxlImage();
  const CHUNK = 1 << 20;
  for (let at = 0; at < blob.size; at += CHUNK) {
    img.feedBytes(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
    if (enough(img)) break;
  }
  return img;
}

async function jxlSize(blob: Blob): Promise<PixelSize> {
  const mod = await loadJxl();
  const img = await feedJxl(mod, blob, (i) => i.tryInit());
  try {
    if (!img.tryInit() || !img.width || !img.height) throw new Error('not a JPEG XL');
    return { width: img.width, height: img.height };
  } finally {
    img.free();
  }
}

async function jxlDecode(blob: Blob): Promise<WasmStill> {
  const mod = await loadJxl();
  const img = await feedJxl(mod, blob, () => false);
  try {
    if (!img.tryInit() || !img.loaded) throw new Error('an incomplete JPEG XL');
    // `encodeToPng` takes the render by value and frees it: freeing it again
    // is a "null pointer passed to rust".
    const png = img.render().encodeToPng();
    return { kind: 'blob', blob: new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }) };
  } finally {
    img.free();
  }
}

/**
 * A JPEG XL codestream's SAMPLES, as they are stored — 16 bits a channel where
 * the file has them, no colour management, no cut to eight bits. For the
 * JPEG XL tiles of a LinearRaw DNG (`raw/jxl-dng.ts`): jxl-oxide's one way out
 * is a PNG, read back by `png-read.ts`.
 */
export async function decodeJxlSamples(bytes: Uint8Array): Promise<PngSamples> {
  const mod = await loadJxl();
  const img = new mod.JxlImage();
  try {
    img.feedBytes(bytes);
    if (!img.tryInit() || !img.loaded) throw new Error('an incomplete JPEG XL tile');
    return await readPngSamples(img.render().encodeToPng());
  } finally {
    img.free();
  }
}

// ── HEIF ───────────────────────────────────────────────────────────────────

interface HeifImageLike {
  handle: number;
  get_width(): number;
  get_height(): number;
  display(target: ImageData, done: (out: ImageData | null) => void): void;
}
interface HeifDecoderLike {
  decoder: number | null;
  decode(bytes: Uint8Array): HeifImageLike[];
}
interface HeifLib {
  HeifDecoder: new () => HeifDecoderLike;
  heif_context_free(ctx: number): void;
  heif_image_handle_release(handle: number): void;
  heif_image_handle_is_primary_image(handle: number): number;
}

/** Seconds of idleness after which the HEIF heap is let go. */
const HEIF_IDLE_MS = 8_000;

let heif: Promise<HeifLib> | null = null;
let heifIdle: ReturnType<typeof setTimeout> | null = null;
let heifBusy = 0;

function releaseHeif() {
  if (heifBusy === 0) heif = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseHeif();
  });
}

function loadHeif(): Promise<HeifLib> {
  heif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(
    (mod) => (mod as { default: () => HeifLib }).default(),
  );
  heif.catch(() => (heif = null));
  return heif;
}

/** Run `work` over the parsed file, its images released and the heap scheduled for release after. */
async function withHeif<T>(blob: Blob, work: (image: HeifImageLike) => Promise<T> | T): Promise<T> {
  heifBusy++;
  if (heifIdle) clearTimeout(heifIdle);
  const lib = await loadHeif();
  const decoder = new lib.HeifDecoder();
  let images: HeifImageLike[] = [];
  try {
    images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
    if (!images.length) throw new Error('no picture in this HEIF');
    // The primary item where the file names one, else the largest.
    const image =
      images.find((i) => lib.heif_image_handle_is_primary_image(i.handle)) ??
      images.reduce((a, b) => (b.get_width() * b.get_height() > a.get_width() * a.get_height() ? b : a));
    return await work(image);
  } finally {
    for (const i of images) lib.heif_image_handle_release(i.handle);
    if (decoder.decoder) lib.heif_context_free(decoder.decoder);
    heifBusy--;
    heifIdle = setTimeout(releaseHeif, HEIF_IDLE_MS);
  }
}

function heifSize(blob: Blob): Promise<PixelSize> {
  return withHeif(blob, (image) => ({ width: image.get_width(), height: image.get_height() }));
}

function heifDecode(blob: Blob): Promise<WasmStill> {
  return withHeif(
    blob,
    (image) =>
      new Promise<WasmStill>((resolve, reject) => {
        const target = new ImageData(image.get_width(), image.get_height());
        image.display(target, (out) =>
          out ? resolve({ kind: 'pixels', image: out }) : reject(new Error('this HEIF did not decode')),
        );
      }),
  );
}

// ── The door ───────────────────────────────────────────────────────────────

/** The picture's upright size, read without decoding its pixels. */
export function wasmStillSize(blob: Blob, format: StillFormat): Promise<PixelSize> {
  return format === 'jxl' ? jxlSize(blob) : heifSize(blob);
}

/** The picture, decoded whole by the decoder shipped for its format. */
export function decodeWasmStill(blob: Blob, format: StillFormat): Promise<WasmStill> {
  return format === 'jxl' ? jxlDecode(blob) : heifDecode(blob);
}
