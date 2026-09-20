/**
 * A LUT lattice as BYTES — the form a purchased look travels and is kept in.
 *
 * A `.cube` is text, and the packs the maintainer buys are 65³: 3.6–6.9 MB
 * each, 25 of them (`docs/lut-packs.md` §2). Text is the wrong shape for that
 * — a document may never carry a lattice at all (§3), a phone should not
 * re-parse six megabytes of ASCII to grade a picture, and the vault has to
 * store and hash something stable.
 *
 * So a lattice is stored as 16-bit samples over its own value range: 1.65 MB
 * for a 65³ look, a quarter of the text, with a quantisation step of
 * `(max − min) / 65535` — about 3e-5 for an ordinary cube, two orders of
 * magnitude finer than the 8-bit output it ends up in. Values outside [0,1]
 * survive (the shipped DJI cube's `#Not-Clipped.` highlights run past 1),
 * because the range is measured from the data and written into the header
 * rather than assumed.
 *
 * Half floats were the obvious alternative and are worse here: their step at
 * 1.0 is 1/1024, twenty times coarser than unorm16 over a [0,1] lattice, for
 * exactly the same number of bytes.
 *
 * Pure and DOM-free: `Uint8Array` in, `CubeLut` out.
 */

import type { CubeLut } from '../lib/cube-parser';

/** `ATL1` — magic, so a truncated or foreign file is refused, not mis-read. */
const MAGIC = 0x41544c31;
const VERSION = 1;
/** magic(4) version(1) flags(1) size(2) domainMin(12) domainMax(12) valueMin(4) valueMax(4). */
export const PACK_HEADER_BYTES = 40;
/** Sizes a `.cube` can declare; anything else is a file we refuse to invent a reading for. */
const MIN_SIZE = 2;
const MAX_SIZE = 256;

/** Bytes an encoded lattice of this grid size takes, header included. */
export function encodedBytes(size: number): number {
  return PACK_HEADER_BYTES + size ** 3 * 3 * 2;
}

/**
 * Encode a parsed cube. The value range is measured, so a lattice that never
 * leaves [0,1] gets the whole 16-bit scale over [0,1] and one that overshoots
 * keeps its highlights.
 */
export function encodeLattice(lut: CubeLut): Uint8Array {
  const { size, data } = lut;
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`A lattice of ${size} points is not one this format can hold.`);
  }
  if (data.length !== size ** 3 * 3) {
    throw new Error('The lattice does not hold size³ triplets.');
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (!Number.isFinite(v)) throw new Error('The lattice holds a value that is not a number.');
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // A flat lattice (every sample identical) has no range to spread over:
  // widening it by one keeps the arithmetic below division-free of zero and
  // still reproduces the value exactly, since every sample encodes to 0.
  if (max === min) max = min + 1;

  const out = new Uint8Array(encodedBytes(size));
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC);
  view.setUint8(4, VERSION);
  view.setUint8(5, 0);
  view.setUint16(6, size);
  for (let i = 0; i < 3; i += 1) view.setFloat32(8 + i * 4, lut.domainMin[i]);
  for (let i = 0; i < 3; i += 1) view.setFloat32(20 + i * 4, lut.domainMax[i]);
  view.setFloat32(32, min);
  view.setFloat32(36, max);

  // The header's range is written as f32 and read back as f32, so quantise
  // against the values the DECODER will see — otherwise the endpoints drift
  // by the f32 rounding and the round-trip is no longer exact at min and max.
  const lo = view.getFloat32(32);
  const hi = view.getFloat32(36);
  // Little-endian, explicitly, on both sides: a `Uint16Array` over the same
  // memory would write whatever this machine happens to use, and the file
  // travels to another one.
  const scale = 65535 / (hi - lo);
  for (let i = 0; i < data.length; i += 1) {
    const q = Math.round((data[i] - lo) * scale);
    view.setUint16(PACK_HEADER_BYTES + i * 2, q < 0 ? 0 : q > 65535 ? 65535 : q, true);
  }
  return out;
}

/**
 * Decode a lattice. Returns null for anything this format cannot answer for —
 * a foreign file, a version from the future, a truncated body — because a
 * cube read wrong would grade every picture silently and wrongly.
 */
export function decodeLattice(bytes: Uint8Array, title?: string): CubeLut | null {
  if (bytes.byteLength < PACK_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== MAGIC) return null;
  if (view.getUint8(4) !== VERSION) return null;

  const size = view.getUint16(6);
  if (size < MIN_SIZE || size > MAX_SIZE) return null;
  const count = size ** 3 * 3;
  if (bytes.byteLength < PACK_HEADER_BYTES + count * 2) return null;

  const domainMin: [number, number, number] = [
    view.getFloat32(8),
    view.getFloat32(12),
    view.getFloat32(16),
  ];
  const domainMax: [number, number, number] = [
    view.getFloat32(20),
    view.getFloat32(24),
    view.getFloat32(28),
  ];
  const lo = view.getFloat32(32);
  const hi = view.getFloat32(36);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;

  const step = (hi - lo) / 65535;
  const data = new Float32Array(count);
  // Read through the DataView, little-endian: the samples are not guaranteed
  // to be 2-byte aligned inside an arbitrary ArrayBuffer (a slice of a fetched
  // body), and a Uint16Array over the same memory would also read in whatever
  // order this machine uses.
  for (let i = 0; i < count; i += 1) {
    data[i] = lo + view.getUint16(PACK_HEADER_BYTES + i * 2, true) * step;
  }
  return { size, data, domainMin, domainMax, ...(title ? { title } : {}) };
}

/**
 * The SHA-256 of some bytes, lowercase hex — what a look is keyed on in the
 * vault and in the file store (`docs/lut-packs.md` §4.3). The SOURCE file's
 * bytes, never its name: a rename, or the author publishing a v2 under the
 * same name, would otherwise pass for the same look.
 */
export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // A fresh copy: `crypto.subtle` wants an ArrayBuffer, and a view into a
  // larger buffer would hash the whole of it.
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
