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

/**
 * A decoded still: a blob the browser draws itself, or RGBA already upright —
 * with the picture's OWN size beside it, since the pixels may be the smaller
 * render a HEIF carries of itself (its thumbnail).
 */
export type WasmStill = { kind: 'blob'; blob: Blob } | { kind: 'pixels'; image: ImageData; natural: PixelSize };

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
  /** An embind handle; its raw pointer is `$$.ptr`, what the C calls below take. */
  handle: { $$?: { ptr?: number } } | number;
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
  heif_image_handle_release(handle: HeifImageLike['handle']): void;
  heif_image_handle_is_primary_image(handle: HeifImageLike['handle']): number;
  // The C API, raw — the JS wrapper exposes no thumbnails.
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _heif_image_handle_get_number_of_thumbnails(handle: number): number;
  _heif_image_handle_get_list_of_thumbnail_IDs(handle: number, ids: number, count: number): number;
  _heif_image_handle_get_thumbnail(error: number, handle: number, id: number, out: number): void;
  _heif_image_handle_get_width(handle: number): number;
  _heif_image_handle_get_height(handle: number): number;
  _heif_image_handle_release(handle: number): void;
  _heif_decode_image(error: number, handle: number, out: number, colorspace: number, chroma: number, options: number): void;
  _heif_image_get_plane_readonly(image: number, channel: number, stride: number): number;
  _heif_image_get_width(image: number, channel: number): number;
  _heif_image_get_height(image: number, channel: number): number;
  _heif_image_release(image: number): void;
}

// libheif's enum values (heif.h): RGB colourspace, interleaved RGBA, the interleaved channel.
const HEIF_RGB = 1;
const HEIF_RGBA = 11;
const HEIF_INTERLEAVED = 10;

/**
 * The smallest THUMBNAIL a HEIF carries of its primary picture that is still
 * at least `want` — decoded to RGBA, or null where there is none big enough
 * (or the C API refuses). An iPhone writes one of ~320 px beside every
 * picture: a Library cover of 200 px decodes that instead of the 12 or 48
 * megapixels, which is seconds and a heap the size of the picture saved per
 * row. libheif turns it with the file's own `irot`, like the primary.
 */
function heifThumbnail(lib: HeifLib, image: HeifImageLike, want: PixelSize): ImageData | null {
  const ptr = typeof image.handle === 'number' ? image.handle : image.handle.$$?.ptr;
  if (!ptr) return null;
  const count = lib._heif_image_handle_get_number_of_thumbnails(ptr);
  if (!(count > 0)) return null;
  const ids = lib._malloc(4 * count);
  const error = lib._malloc(16);
  const out = lib._malloc(4);
  const stride = lib._malloc(4);
  const handles: number[] = [];
  try {
    lib._heif_image_handle_get_list_of_thumbnail_IDs(ptr, ids, count);
    let best: { handle: number; area: number } | null = null;
    for (let i = 0; i < count; i += 1) {
      lib._heif_image_handle_get_thumbnail(error, ptr, lib.HEAPU32[(ids >> 2) + i], out);
      if (lib.HEAP32[error >> 2] !== 0) continue;
      const handle = lib.HEAPU32[out >> 2];
      handles.push(handle);
      const w = lib._heif_image_handle_get_width(handle);
      const h = lib._heif_image_handle_get_height(handle);
      if (w >= want.width && h >= want.height && (!best || w * h < best.area)) best = { handle, area: w * h };
    }
    if (!best) return null;
    lib._heif_decode_image(error, best.handle, out, HEIF_RGB, HEIF_RGBA, 0);
    if (lib.HEAP32[error >> 2] !== 0) return null;
    const decoded = lib.HEAPU32[out >> 2];
    try {
      const w = lib._heif_image_get_width(decoded, HEIF_INTERLEAVED);
      const h = lib._heif_image_get_height(decoded, HEIF_INTERLEAVED);
      const plane = lib._heif_image_get_plane_readonly(decoded, HEIF_INTERLEAVED, stride);
      const rowBytes = lib.HEAP32[stride >> 2];
      if (!plane || !(w > 0) || !(h > 0)) return null;
      const pixels = new ImageData(w, h);
      for (let y = 0; y < h; y += 1) {
        pixels.data.set(lib.HEAPU8.subarray(plane + y * rowBytes, plane + y * rowBytes + w * 4), y * w * 4);
      }
      return pixels;
    } finally {
      lib._heif_image_release(decoded);
    }
  } catch {
    return null;
  } finally {
    for (const handle of handles) lib._heif_image_handle_release(handle);
    lib._free(ids);
    lib._free(error);
    lib._free(out);
    lib._free(stride);
  }
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
async function withHeif<T>(blob: Blob, work: (image: HeifImageLike, lib: HeifLib) => Promise<T> | T): Promise<T> {
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
    return await work(image, lib);
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

function heifDecode(blob: Blob, want?: (natural: PixelSize) => PixelSize): Promise<WasmStill> {
  return withHeif(blob, (image, lib) => {
    const natural = { width: image.get_width(), height: image.get_height() };
    // A small ask is answered by the render the file carries of itself.
    const target = want?.(natural);
    if (target && (target.width < natural.width || target.height < natural.height)) {
      const thumb = heifThumbnail(lib, image, target);
      if (thumb) return { kind: 'pixels', image: thumb, natural } as WasmStill;
    }
    return new Promise<WasmStill>((resolve, reject) => {
      const pixels = new ImageData(natural.width, natural.height);
      image.display(pixels, (out) =>
        out ? resolve({ kind: 'pixels', image: out, natural }) : reject(new Error('this HEIF did not decode')),
      );
    });
  });
}

// ── The door ───────────────────────────────────────────────────────────────

/** The picture's upright size, read without decoding its pixels. */
export function wasmStillSize(blob: Blob, format: StillFormat): Promise<PixelSize> {
  return format === 'jxl' ? jxlSize(blob) : heifSize(blob);
}

/**
 * The picture, decoded by the decoder shipped for its format — whole, or for a
 * HEIF asked for less than itself (`want`, the size a caller will draw it at),
 * from the thumbnail the file carries when one is big enough.
 */
export function decodeWasmStill(
  blob: Blob,
  format: StillFormat,
  want?: (natural: PixelSize) => PixelSize,
): Promise<WasmStill> {
  return format === 'jxl' ? jxlDecode(blob) : heifDecode(blob, want);
}
