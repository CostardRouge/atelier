/**
 * A QR code encoder — byte mode, error-correction level M, versions 1 to 10.
 *
 * Hand-rolled rather than pulled in, for the reason the whole suite exists:
 * nothing may leave the machine, and a call-to-action slide that fetched its
 * QR from a web service would be the one place the tool phoned home. It is
 * also small enough to hold: ~250 lines against a spec that has not moved
 * since 2000.
 *
 * Scope is deliberate. Byte mode encodes any UTF-8 string, so numeric and
 * alphanumeric modes would only buy density nobody needs here; level M gives
 * ~15 % recovery, the usual choice for something printed large; version 10
 * holds 213 bytes, several times any URL worth putting on a slide. A string
 * that does not fit returns null rather than silently truncating — a QR that
 * scans to half a URL is worse than no QR.
 *
 * Pure and DOM-free. The drawing lives in roadtrip/badge-render.ts.
 */

/** A finished code: `size × size` modules, row-major, true = dark. */
export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[];
}

// ---------------------------------------------------------------------------
// GF(256), the field Reed–Solomon works in
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // The primitive polynomial x⁸+x⁴+x³+x²+1, as the standard fixes it.
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function gmul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** g(x) = ∏(x − α^i), ascending coefficients; monic, so the top one is 1. */
function rsGenerator(degree: number): number[] {
  let c = [1];
  for (let i = 0; i < degree; i++) {
    const out = new Array<number>(c.length + 1).fill(0);
    for (let k = 0; k <= c.length; k++) {
      const shifted = k > 0 ? c[k - 1] : 0;
      const scaled = k < c.length ? gmul(c[k], EXP[i]) : 0;
      out[k] = shifted ^ scaled;
    }
    c = out;
  }
  return c;
}

/** The error-correction codewords for one block: polynomial long division. */
export function rsEncode(data: Uint8Array, ecLength: number): Uint8Array {
  const gen = rsGenerator(ecLength).reverse(); // descending; gen[0] === 1
  const work = new Uint8Array(data.length + ecLength);
  work.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = work[i];
    if (coef === 0) continue;
    for (let j = 1; j <= ecLength; j++) work[i + j] ^= gmul(gen[j], coef);
  }
  return work.slice(data.length);
}

// ---------------------------------------------------------------------------
// The version tables (error-correction level M only)
// ---------------------------------------------------------------------------

interface VersionSpec {
  /** Data + error-correction codewords together. */
  total: number;
  /** Error-correction codewords per block. */
  ec: number;
  /** `[blocks, data codewords each]`, in interleaving order. */
  groups: [number, number][];
}

const VERSIONS: readonly VersionSpec[] = [
  { total: 26, ec: 10, groups: [[1, 16]] },
  { total: 44, ec: 16, groups: [[1, 28]] },
  { total: 70, ec: 26, groups: [[1, 44]] },
  { total: 100, ec: 18, groups: [[2, 32]] },
  { total: 134, ec: 24, groups: [[2, 43]] },
  { total: 172, ec: 16, groups: [[4, 27]] },
  { total: 196, ec: 18, groups: [[4, 31]] },
  { total: 242, ec: 22, groups: [[2, 38], [2, 39]] },
  { total: 292, ec: 22, groups: [[3, 36], [2, 37]] },
  { total: 346, ec: 26, groups: [[4, 43], [1, 44]] },
];

/** Alignment-pattern centres per version (none on version 1). */
const ALIGNMENT: readonly number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function dataCodewords(spec: VersionSpec): number {
  return spec.groups.reduce((sum, [blocks, each]) => sum + blocks * each, 0);
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function bitsFor(value: number, length: number, out: number[]): void {
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

/** The smallest version that holds `byteLength`, or null when none does. */
function chooseVersion(byteLength: number): number | null {
  for (let v = 1; v <= VERSIONS.length; v++) {
    const spec = VERSIONS[v - 1];
    const countBits = v <= 9 ? 8 : 16;
    const available = dataCodewords(spec) * 8 - 4 - countBits;
    if (byteLength * 8 <= available) return v;
  }
  return null;
}

/** Data codewords: header, payload, terminator, padding. */
function buildCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = VERSIONS[version - 1];
  const capacity = dataCodewords(spec);
  const bits: number[] = [];

  bitsFor(0b0100, 4, bits); // byte mode
  bitsFor(bytes.length, version <= 9 ? 8 : 16, bits);
  for (const b of bytes) bitsFor(b, 8, bits);

  // Terminator, then out to a whole byte.
  const room = capacity * 8 - bits.length;
  bitsFor(0, Math.min(4, room), bits);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out[i / 8] = byte;
  }
  // The two pad bytes the standard names, alternating.
  for (let i = bits.length / 8, alt = 0; i < capacity; i++, alt++) {
    out[i] = alt % 2 === 0 ? 0xec : 0x11;
  }
  return out;
}

/** Split into blocks, add error correction, interleave both halves. */
function interleave(data: Uint8Array, version: number): Uint8Array {
  const spec = VERSIONS[version - 1];
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (const [blocks, each] of spec.groups) {
    for (let i = 0; i < blocks; i++) {
      const block = data.slice(offset, offset + each);
      offset += each;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, spec.ec));
    }
  }

  const out = new Uint8Array(spec.total);
  let k = 0;
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out[k++] = block[i];
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const block of ecBlocks) out[k++] = block[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

class Grid {
  readonly size: number;
  readonly modules: boolean[];
  /** Function patterns, which the data skips and the mask never touches. */
  readonly reserved: boolean[];

  constructor(version: number) {
    this.size = version * 4 + 17;
    this.modules = new Array<boolean>(this.size * this.size).fill(false);
    this.reserved = new Array<boolean>(this.size * this.size).fill(false);
  }

  set(row: number, col: number, dark: boolean, isFunction = false): void {
    if (row < 0 || col < 0 || row >= this.size || col >= this.size) return;
    this.modules[row * this.size + col] = dark;
    if (isFunction) this.reserved[row * this.size + col] = true;
  }

  get(row: number, col: number): boolean {
    return this.modules[row * this.size + col];
  }

  isReserved(row: number, col: number): boolean {
    return this.reserved[row * this.size + col];
  }
}

function drawFinder(grid: Grid, row: number, col: number): void {
  // The 7×7 eye plus its one-module separator, clipped at the frame's edge.
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inEye =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      grid.set(row + r, col + c, inEye, true);
    }
  }
}

function drawAlignment(grid: Grid, row: number, col: number): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      grid.set(row + r, col + c, dark, true);
    }
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;

  drawFinder(grid, 0, 0);
  drawFinder(grid, 0, size - 7);
  drawFinder(grid, size - 7, 0);

  // Timing lines, running between the finders.
  for (let i = 8; i < size - 8; i++) {
    grid.set(6, i, i % 2 === 0, true);
    grid.set(i, 6, i % 2 === 0, true);
  }

  const centres = ALIGNMENT[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      // The three that would sit on a finder are omitted.
      const onFinder =
        (r === 6 && c === 6) ||
        (r === 6 && c === size - 7) ||
        (r === size - 7 && c === 6);
      if (!onFinder) drawAlignment(grid, r, c);
    }
  }

  // Reserve the format strips (written after the mask is chosen). Index 6 is
  // skipped on purpose: row 6 and column 6 belong to the timing patterns, and
  // blanking them here silently punched two holes in the very lines a decoder
  // uses to find the module grid. Error correction hid it from a round trip.
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    grid.set(8, i, false, true);
    grid.set(i, 8, false, true);
  }
  for (let i = 0; i < 8; i++) {
    grid.set(8, size - 1 - i, false, true);
    grid.set(size - 1 - i, 8, false, true);
  }
  // The one module that is always dark.
  grid.set(size - 8, 8, true, true);

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.set(b, a, bit, true);
      grid.set(a, b, bit, true);
    }
  }
}

/** BCH(18,6) over the version number. */
function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25);
  return (version << 12) | rem;
}

/** BCH(15,5) over the EC level and mask, masked as the standard requires. */
function formatBits(mask: number): number {
  // Level M is `00`.
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(grid: Grid, mask: number): void {
  const bits = formatBits(mask);
  const size = grid.size;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) grid.set(i, 8, bit(i), true);
  grid.set(7, 8, bit(6), true);
  grid.set(8, 8, bit(7), true);
  grid.set(8, 7, bit(8), true);
  for (let i = 9; i < 15; i++) grid.set(8, 14 - i, bit(i), true);

  for (let i = 0; i < 8; i++) grid.set(8, size - 1 - i, bit(i), true);
  for (let i = 8; i < 15; i++) grid.set(size - 15 + i, 8, bit(i), true);
  grid.set(size - 8, 8, true, true);
}

/** Zigzag placement: two columns at a time, right to left, skipping column 6. */
function drawCodewords(grid: Grid, codewords: Uint8Array): void {
  const size = grid.size;
  let i = 0;
  const totalBits = codewords.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (grid.isReserved(row, col)) continue;
        // Past the data sit the version's remainder bits, which are zeros —
        // already what an untouched module is, so nothing to write.
        if (i < totalBits) {
          const dark = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          grid.set(row, col, dark);
        }
        i++;
      }
    }
  }
}

function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(col / 3) + Math.floor(row / 2)) % 2 === 0;
    case 5:
      return ((col * row) % 2) + ((col * row) % 3) === 0;
    case 6:
      return (((col * row) % 2) + ((col * row) % 3)) % 2 === 0;
    default:
      return (((col + row) % 2) + ((col * row) % 3)) % 2 === 0;
  }
}

function applyMask(grid: Grid, mask: number): void {
  for (let row = 0; row < grid.size; row++) {
    for (let col = 0; col < grid.size; col++) {
      if (grid.isReserved(row, col)) continue;
      if (maskAt(mask, row, col)) {
        grid.set(row, col, !grid.get(row, col));
      }
    }
  }
}

/** The standard's four penalties. Only their ORDER matters — any mask scans. */
function penalty(grid: Grid): number {
  const size = grid.size;
  let score = 0;

  for (let a = 0; a < size; a++) {
    let rowRun = 1;
    let colRun = 1;
    for (let b = 1; b < size; b++) {
      rowRun = grid.get(a, b) === grid.get(a, b - 1) ? rowRun + 1 : 1;
      if (rowRun === 5) score += 3;
      else if (rowRun > 5) score += 1;
      colRun = grid.get(b, a) === grid.get(b - 1, a) ? colRun + 1 : 1;
      if (colRun === 5) score += 3;
      else if (colRun > 5) score += 1;
    }
  }

  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const v = grid.get(row, col);
      if (
        v === grid.get(row, col + 1) &&
        v === grid.get(row + 1, col) &&
        v === grid.get(row + 1, col + 1)
      ) {
        score += 3;
      }
    }
  }

  // The finder-like run, in both directions and both polarities.
  const PATTERN = [true, false, true, true, true, false, true];
  const hasAt = (get: (i: number) => boolean, start: number, len: number) => {
    for (let i = 0; i < 7; i++) if (get(start + i) !== PATTERN[i]) return false;
    const before = Array.from({ length: 4 }, (_, i) => start - 1 - i).every(
      (i) => i < 0 || !get(i),
    );
    const after = Array.from({ length: 4 }, (_, i) => start + 7 + i).every(
      (i) => i >= len || !get(i),
    );
    return before || after;
  };
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + 7 <= size; b++) {
      if (hasAt((i) => grid.get(a, i), b, size)) score += 40;
      if (hasAt((i) => grid.get(i, a), b, size)) score += 40;
    }
  }

  let dark = 0;
  for (const m of grid.modules) if (m) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encode `text` as a QR code, or null when it is empty or too long for
 * version 10 at level M (213 bytes of UTF-8).
 */
export function encodeQr(text: string): QrMatrix | null {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) return null;
  const version = chooseVersion(bytes.length);
  if (version === null) return null;

  const codewords = interleave(buildCodewords(bytes, version), version);

  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = new Grid(version);
    drawFunctionPatterns(grid, version);
    drawCodewords(grid, codewords);
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }
  if (!best) return null;

  return { version, size: best.size, modules: best.modules };
}

/** Longest UTF-8 payload this encoder can carry. */
export const QR_MAX_BYTES = 213;

/** Whether `text` fits, so a caller can say so before drawing nothing. */
export function qrFits(text: string): boolean {
  return new TextEncoder().encode(text).length <= QR_MAX_BYTES;
}
