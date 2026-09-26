/**
 * A PNG's SAMPLES, 8 or 16 bits a channel, read without a browser decoder —
 * DOM-free, runs in node.
 *
 * What for: `jxl-oxide-wasm`, the JPEG XL decoder this suite ships, has one
 * way out — a PNG — and a JPEG XL tile of a ProRAW DNG holds the SENSOR's
 * linear data, which a browser's `<img>` would colour-manage and cut to eight
 * bits on the way to a bitmap. So the PNG is unpacked here: the IDAT chunks
 * inflated through `DecompressionStream('deflate')` (zlib framing, which is
 * what a PNG's IDAT is) and each row un-filtered, big-endian samples read
 * back to numbers. Non-interlaced only — jxl-oxide never interlaces — and
 * alpha is dropped, since nothing downstream reads it.
 */

export interface PngSamples {
  width: number;
  height: number;
  /** 1 (grey) or 3 (RGB): alpha is dropped. */
  channels: 1 | 3;
  /** 8 or 16. */
  bitDepth: number;
  /** Row-major, interleaved, in the file's own range (0–255 or 0–65535). */
  data: Uint16Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels stored per colour type: grey, RGB, grey + alpha, RGBA. */
const STORED: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

async function inflate(chunks: Uint8Array[]): Promise<Uint8Array> {
  const stream = new Blob(chunks as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
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
 * Undo the five PNG row filters in place, into `out` (`height × stride`
 * bytes); `raw` is the inflated stream, one filter byte ahead of each row.
 * Exported for the spec.
 */
export function unfilterRows(raw: Uint8Array, out: Uint8Array, height: number, stride: number, bpp: number): void {
  if (raw.length < height * (stride + 1)) throw new Error('PNG data is shorter than its header says');
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[up + i] : 0;
      const c = i >= bpp && y > 0 ? out[up + i - bpp] : 0;
      let p = 0;
      switch (filter) {
        case 0:
          p = 0;
          break;
        case 1:
          p = a;
          break;
        case 2:
          p = b;
          break;
        case 3:
          p = (a + b) >> 1;
          break;
        case 4:
          p = paeth(a, b, c);
          break;
        default:
          throw new Error(`PNG row filter ${filter} is not one of the five`);
      }
      out[dst + i] = (raw[src + i] + p) & 0xff;
    }
  }
}

/** Read a PNG's samples. Throws on anything but a non-interlaced grey or RGB(A) PNG. */
export async function readPngSamples(bytes: Uint8Array): Promise<PngSamples> {
  if (bytes.length < 33 || !SIGNATURE.every((v, i) => bytes[i] === v)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const body = at + 8;
    if (body + length > bytes.length) throw new Error(`PNG chunk ${type} runs past the file`);
    if (type === 'IHDR') {
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      bitDepth = bytes[body + 8];
      colorType = bytes[body + 9];
      if (bytes[body + 12] !== 0) throw new Error('an interlaced PNG is not read here');
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(body, body + length));
    } else if (type === 'IEND') {
      break;
    }
    at = body + length + 4;
  }
  const stored = STORED[colorType];
  if (!stored || (bitDepth !== 8 && bitDepth !== 16) || !width || !height) {
    throw new Error(`PNG colour type ${colorType} at ${bitDepth} bits is not read here`);
  }
  const bytesPer = bitDepth / 8;
  const bpp = stored * bytesPer;
  const stride = width * bpp;
  const rows = new Uint8Array(height * stride);
  unfilterRows(await inflate(idat), rows, height, stride, bpp);

  const channels: 1 | 3 = stored >= 3 ? 3 : 1;
  const data = new Uint16Array(width * height * channels);
  for (let p = 0, o = 0; p < width * height; p += 1) {
    const base = p * bpp;
    for (let c = 0; c < channels; c += 1, o += 1) {
      const s = base + c * bytesPer;
      data[o] = bytesPer === 2 ? (rows[s] << 8) | rows[s + 1] : rows[s];
    }
  }
  return { width, height, channels, bitDepth, data };
}
