/**
 * A 16-bit PNG, written by hand — the one way a photograph leaves this suite
 * with more than 8 bits a channel.
 *
 * `canvas.toBlob` encodes 8 bits and nothing else, so a 16-bit file is written
 * here: an RGB picture of `Uint16` samples, big-endian as the format wants,
 * each row Paeth-filtered (the predictor a photograph compresses best under)
 * and the stream deflated through `CompressionStream('deflate')` — zlib
 * framing, which is what an IDAT holds and what `png-read.ts` inflates. Three
 * optional chunks carry what a delivered JPEG carries: `eXIf` (the TIFF block
 * `exif-block.ts` makes, which is the chunk's exact content), `iTXt` with the
 * XMP packet under `XML:com.adobe.xmp`, and `iCCP` with the sRGB profile
 * `icc-srgb.ts` builds, deflated as the chunk requires.
 *
 * DOM-free: runs in node (`CompressionStream` is a global there too), where
 * the spec round-trips a file through `readPngSamples`.
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over `type` + `data`, as a PNG chunk wants. Exported for the spec. */
export function crc32(...parts: readonly Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) c = CRC_TABLE[(c ^ part[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = ascii(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(name, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(name, data));
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * The rows as the stream wants them: each one a filter byte then its bytes,
 * big-endian 16-bit samples, Paeth-filtered against the row above. Exported
 * for the spec; `png-read.ts`'s `unfilterRows` is its inverse.
 */
export function filterRows16(rgb: Uint16Array, width: number, height: number): Uint8Array {
  const bpp = 6;
  const stride = width * bpp;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    for (let x = 0; x < width; x += 1) {
      const s = (y * width + x) * 3;
      const o = row + x * bpp;
      raw[o] = rgb[s] >> 8;
      raw[o + 1] = rgb[s] & 0xff;
      raw[o + 2] = rgb[s + 1] >> 8;
      raw[o + 3] = rgb[s + 1] & 0xff;
      raw[o + 4] = rgb[s + 2] >> 8;
      raw[o + 5] = rgb[s + 2] & 0xff;
    }
  }
  const out = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const src = y * stride;
    const dst = y * (stride + 1);
    out[dst] = 4;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? raw[src + i - bpp] : 0;
      const b = y > 0 ? raw[src - stride + i] : 0;
      const c = i >= bpp && y > 0 ? raw[src - stride + i - bpp] : 0;
      out[dst + 1 + i] = (raw[src + i] - paeth(a, b, c)) & 0xff;
    }
  }
  return out;
}

export interface PngChunks {
  /** The EXIF TIFF block — `exif-block.ts`'s, without `Exif\0\0`. */
  exif?: Uint8Array | null;
  /** The XMP packet, as text. */
  xmp?: string | null;
  /** An ICC profile, raw. */
  icc?: Uint8Array | null;
}

/**
 * A 16-bit RGB PNG of `rgb` (row-major, three samples a pixel, 0–65535).
 * Chunks after `IHDR`, before the picture, in the order readers expect:
 * `iCCP`, `eXIf`, `iTXt`.
 */
export async function encodePng16(rgb: Uint16Array, width: number, height: number, chunks: PngChunks = {}): Promise<Uint8Array> {
  if (!(width > 0 && height > 0) || rgb.length < width * height * 3) throw new Error('a PNG needs its pixels');
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // not interlaced
  const parts: Uint8Array[] = [SIGNATURE, chunk('IHDR', ihdr)];
  if (chunks.icc?.length) {
    const name = ascii('sRGB');
    const body = new Uint8Array(name.length + 2 + 0);
    body.set(name, 0);
    body[name.length] = 0; // null-terminated name
    body[name.length + 1] = 0; // compression method: deflate
    const profile = await deflate(chunks.icc);
    const data = new Uint8Array(body.length + profile.length);
    data.set(body, 0);
    data.set(profile, body.length);
    parts.push(chunk('iCCP', data));
  }
  if (chunks.exif?.length) parts.push(chunk('eXIf', chunks.exif));
  if (chunks.xmp) {
    const keyword = ascii('XML:com.adobe.xmp');
    const text = new TextEncoder().encode(chunks.xmp);
    // keyword, NUL, compression flag 0, method 0, language tag (empty) NUL, translated keyword (empty) NUL, text
    const data = new Uint8Array(keyword.length + 5 + text.length);
    data.set(keyword, 0);
    data.set(text, keyword.length + 5);
    parts.push(chunk('iTXt', data));
  }
  parts.push(chunk('IDAT', await deflate(filterRows16(rgb, width, height))));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The chunk types a PNG carries, in order — for a check that a file says what was written. */
export function pngChunkTypes(bytes: Uint8Array): string[] {
  const out: string[] = [];
  if (bytes.length < 8) return out;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    out.push(String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]));
    at += 12 + length;
  }
  return out;
}
