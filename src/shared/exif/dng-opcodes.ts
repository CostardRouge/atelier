/**
 * The CALIBRATION a DNG carries for the body that shot it — read from the
 * file, never invented.
 *
 * A DNG's `OpcodeList1/2/3` tags hold a list of operations the camera says a
 * correct conversion must apply. LibRaw applies NONE of them, which is why
 * `base: 'raw'` on a DJI file comes out sharper than the camera's own render
 * **and wrong**: measured on `dji_fly_*.DNG` (body FC8482), `OpcodeList3`
 * asks for up to **5.93×** at the corners — about 2.5 stops of vignetting,
 * and a different figure per channel, so colour shading too — plus a
 * WarpRectilinear that is almost purely a 4.93 % magnification.
 *
 * Two opcodes are read here, the two that file writes:
 *
 * - **GainMap (9)** — a grid of multiplicative gains per colour plane. It is
 *   NOT radial, so `render/lens.ts`'s `vignetteGain(r, …)` cannot express it
 *   at all: a grid is a grid, and a lens's shading is only approximately
 *   circular once a sensor's microlenses and a cover glass are in it.
 * - **WarpRectilinear (1)** — a per-plane radial polynomial about an optical
 *   centre, which is exactly the shape `lens.ts` already speaks.
 *
 * **The bytes are always BIG-ENDIAN**, whatever the TIFF's own byte order —
 * the one trap in this format, and a little-endian read of a DJI file gives
 * gains around 1e-40 rather than around 1, which is a correction that turns a
 * picture black rather than one that merely looks wrong.
 *
 * Pure and DOM-free: it reads a `DataView` the probe already has.
 */

/** DNG opcode ids, of the two this reads. */
const OP_WARP_RECTILINEAR = 1;
const OP_GAIN_MAP = 9;

/**
 * One GainMap opcode: a grid of gains over a rectangle of the image.
 *
 * `rect` is in the image's own PIXELS, as the file states it; the nodes sit
 * at `origin + i·spacing` in coordinates where that rectangle is [0,1].
 */
export interface DngGainMap {
  rect: { top: number; left: number; bottom: number; right: number };
  /** The first colour plane this map applies to, and how many it covers. */
  plane: number;
  planes: number;
  rows: number;
  cols: number;
  originV: number;
  originH: number;
  spacingV: number;
  spacingH: number;
  /** How many planes the GRID itself holds: 1 (shared) or one per plane. */
  mapPlanes: number;
  /** Row-major, `rows × cols × mapPlanes` gains. */
  gains: Float32Array;
}

/** One plane's WarpRectilinear terms: four radial, two tangential. */
export interface DngWarpPlane {
  /** `k0..k3`: `ratio = k0 + k1·r² + k2·r⁴ + k3·r⁶`, k0 a pure magnification. */
  radial: [number, number, number, number];
  /** The two tangential terms, zero on a well-centred lens. */
  tangential: [number, number];
}

export interface DngWarp {
  /** One entry (shared by every plane) or three, red first. */
  planes: DngWarpPlane[];
  /** The optical centre, in [0,1] of the image. */
  centerH: number;
  centerV: number;
}

export interface DngOpcodes {
  gainMaps: DngGainMap[];
  warp: DngWarp | null;
  /** Ids present that this reader does not apply — said, never silently dropped. */
  unread: number[];
}

const EMPTY: DngOpcodes = { gainMaps: [], warp: null, unread: [] };

/**
 * Read one opcode list's bytes.
 *
 * Anything malformed yields what was read so far rather than throwing: a
 * partial calibration is still calibration, and a file we cannot parse must
 * degrade to "no rungs offered", never to an exception inside a decode.
 */
export function parseOpcodeList(view: DataView, offset: number, length: number): DngOpcodes {
  if (!Number.isFinite(offset) || !Number.isFinite(length) || length < 4) return EMPTY;
  if (offset < 0 || offset + length > view.byteLength) return EMPTY;
  const gainMaps: DngGainMap[] = [];
  const unread: number[] = [];
  let warp: DngWarp | null = null;
  try {
    const end = offset + length;
    const count = view.getUint32(offset, false);
    let at = offset + 4;
    // A count a corrupt tag could make enormous is bounded by the bytes: each
    // opcode costs at least its 16-byte header.
    for (let i = 0; i < count && at + 16 <= end; i += 1) {
      const id = view.getUint32(at, false);
      const bytes = view.getUint32(at + 12, false);
      const params = at + 16;
      if (!Number.isFinite(bytes) || params + bytes > end) break;
      if (id === OP_GAIN_MAP) {
        const map = readGainMap(view, params, bytes);
        if (map) gainMaps.push(map);
        else unread.push(id);
      } else if (id === OP_WARP_RECTILINEAR) {
        const w = readWarp(view, params, bytes);
        if (w) warp = w;
        else unread.push(id);
      } else if (!unread.includes(id)) {
        unread.push(id);
      }
      at = params + bytes;
    }
  } catch {
    // Fall through with whatever was read.
  }
  return { gainMaps, warp, unread };
}

/** The 76 fixed bytes of a GainMap, then `rows × cols × mapPlanes` float32s. */
function readGainMap(view: DataView, at: number, bytes: number): DngGainMap | null {
  if (bytes < 76) return null;
  const u32 = (i: number) => view.getUint32(at + i * 4, false);
  const f64 = (i: number) => view.getFloat64(at + 40 + i * 8, false);
  const top = u32(0);
  const left = u32(1);
  const bottom = u32(2);
  const right = u32(3);
  const plane = u32(4);
  const planes = u32(5);
  const rowPitch = u32(6);
  const colPitch = u32(7);
  const rows = u32(8);
  const cols = u32(9);
  const mapPlanes = view.getUint32(at + 72, false);
  // A pitch above 1 addresses ONE CFA plane of a mosaic (OpcodeList2's job),
  // not the demosaiced image this applies to. Refused rather than applied to
  // every pixel, which would be a real correction of the wrong thing.
  if (rowPitch !== 1 || colPitch !== 1) return null;
  if (rows <= 0 || cols <= 0 || mapPlanes <= 0 || mapPlanes > 4) return null;
  if (bottom <= top || right <= left) return null;
  const need = rows * cols * mapPlanes;
  if (76 + need * 4 > bytes) return null;
  const gains = new Float32Array(need);
  for (let i = 0; i < need; i += 1) gains[i] = view.getFloat32(at + 76 + i * 4, false);
  return {
    rect: { top, left, bottom, right },
    plane,
    planes,
    rows,
    cols,
    spacingV: f64(0),
    spacingH: f64(1),
    originV: f64(2),
    originH: f64(3),
    mapPlanes,
    gains,
  };
}

/** `N`, then `N × 6` doubles, then the optical centre's two. */
function readWarp(view: DataView, at: number, bytes: number): DngWarp | null {
  if (bytes < 4) return null;
  const n = view.getUint32(at, false);
  if (n !== 1 && n !== 3) return null;
  if (bytes < 4 + n * 48 + 16) return null;
  const planes: DngWarpPlane[] = [];
  for (let p = 0; p < n; p += 1) {
    const base = at + 4 + p * 48;
    const k = (i: number) => view.getFloat64(base + i * 8, false);
    planes.push({ radial: [k(0), k(1), k(2), k(3)], tangential: [k(4), k(5)] });
  }
  const c = at + 4 + n * 48;
  return { planes, centerH: view.getFloat64(c, false), centerV: view.getFloat64(c + 8, false) };
}

/** True when this warp would move no pixel — every plane an identity. */
export function isIdentityWarp(w: DngWarp | null | undefined): boolean {
  if (!w || w.planes.length === 0) return true;
  return w.planes.every(
    (p) =>
      p.radial[0] === 1 &&
      p.radial[1] === 0 &&
      p.radial[2] === 0 &&
      p.radial[3] === 0 &&
      p.tangential[0] === 0 &&
      p.tangential[1] === 0,
  );
}

/** One plane's terms, by index — a one-plane warp answers for all three. */
export function warpPlane(w: DngWarp, plane: number): DngWarpPlane {
  return w.planes[Math.min(plane, w.planes.length - 1)];
}

/**
 * `gain map 32×32 ×3 · up to 5.93× · warp ×1.049` — what the file really asks
 * for, in the numbers a person can check against the picture.
 */
export function describeOpcodes(o: DngOpcodes | null | undefined): string {
  if (!o) return '';
  const parts: string[] = [];
  for (const m of o.gainMaps) {
    let max = 1;
    for (const g of m.gains) if (g > max) max = g;
    parts.push(`gain map ${m.cols}×${m.rows} ×${m.mapPlanes} · up to ${max.toFixed(2)}×`);
  }
  if (o.warp && !isIdentityWarp(o.warp)) {
    const k0 = o.warp.planes.map((p) => p.radial[0]);
    const mid = k0[Math.floor(k0.length / 2)];
    parts.push(`warp ×${mid.toFixed(3)}`);
  }
  if (o.unread.length) parts.push(`${o.unread.length} opcode${o.unread.length > 1 ? 's' : ''} not applied`);
  return parts.join(' · ');
}
