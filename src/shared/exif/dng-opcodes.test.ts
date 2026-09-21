import { describe, expect, it } from 'vitest';
import {
  describeOpcodes,
  isIdentityWarp,
  parseOpcodeList,
  warpPlane,
} from './dng-opcodes';

/** Build an opcode list exactly as a DNG holds one: big-endian, always. */
function opcodeList(opcodes: { id: number; params: ArrayBuffer }[]): DataView {
  const total = 4 + opcodes.reduce((n, o) => n + 16 + o.params.byteLength, 0);
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  v.setUint32(0, opcodes.length, false);
  let at = 4;
  for (const o of opcodes) {
    v.setUint32(at, o.id, false);
    v.setUint32(at + 4, 0x01040000, false); // dngVersion
    v.setUint32(at + 8, 0, false); // flags
    v.setUint32(at + 12, o.params.byteLength, false);
    new Uint8Array(buf).set(new Uint8Array(o.params), at + 16);
    at += 16 + o.params.byteLength;
  }
  return v;
}

function gainMapParams({
  rows = 2,
  cols = 2,
  mapPlanes = 3,
  rect = { top: 0, left: 0, bottom: 4536, right: 8064 },
  rowPitch = 1,
  colPitch = 1,
  gains,
}: {
  rows?: number;
  cols?: number;
  mapPlanes?: number;
  rect?: { top: number; left: number; bottom: number; right: number };
  rowPitch?: number;
  colPitch?: number;
  gains?: number[];
} = {}): ArrayBuffer {
  const values = gains ?? new Array(rows * cols * mapPlanes).fill(1);
  const buf = new ArrayBuffer(76 + values.length * 4);
  const v = new DataView(buf);
  const u32 = [rect.top, rect.left, rect.bottom, rect.right, 0, 3, rowPitch, colPitch, rows, cols];
  u32.forEach((n, i) => v.setUint32(i * 4, n, false));
  // spacingV, spacingH, originV, originH
  v.setFloat64(40, 1 / (rows - 1), false);
  v.setFloat64(48, 1 / (cols - 1), false);
  v.setFloat64(56, 0, false);
  v.setFloat64(64, 0, false);
  v.setUint32(72, mapPlanes, false);
  values.forEach((g, i) => v.setFloat32(76 + i * 4, g, false));
  return buf;
}

function warpParams(planes: number[][], centerH = 0.5, centerV = 0.5): ArrayBuffer {
  const n = planes.length;
  const buf = new ArrayBuffer(4 + n * 48 + 16);
  const v = new DataView(buf);
  v.setUint32(0, n, false);
  planes.forEach((k, p) => k.forEach((x, i) => v.setFloat64(4 + p * 48 + i * 8, x, false)));
  v.setFloat64(4 + n * 48, centerH, false);
  v.setFloat64(4 + n * 48 + 8, centerV, false);
  return buf;
}

describe('parseOpcodeList', () => {
  it('reads a GainMap the way the DJI file writes one', () => {
    const gains = [
      // top-left node, RGB
      5.93, 5.06, 4.97,
      // top-right
      5.9, 5.0, 4.9,
      // bottom-left
      5.8, 4.9, 4.8,
      // bottom-right
      1.0, 1.0, 1.0,
    ];
    const v = opcodeList([{ id: 9, params: gainMapParams({ gains }) }]);
    const out = parseOpcodeList(v, 0, v.byteLength);
    expect(out.gainMaps).toHaveLength(1);
    const m = out.gainMaps[0];
    expect(m.rows).toBe(2);
    expect(m.cols).toBe(2);
    expect(m.mapPlanes).toBe(3);
    expect(m.rect).toEqual({ top: 0, left: 0, bottom: 4536, right: 8064 });
    expect(Array.from(m.gains.slice(0, 3)).map((g) => +g.toFixed(2))).toEqual([5.93, 5.06, 4.97]);
    expect(out.unread).toEqual([]);
  });

  it('reads the three-plane WarpRectilinear, and its optical centre', () => {
    const v = opcodeList([
      {
        id: 1,
        params: warpParams(
          [
            [1.0493, 0, 0, 0, 0, 0],
            [1.0493, 0, 0, 0, 0, 0],
            [1.0495, 0, 0, 0, 0, 0],
          ],
          0.4998,
          0.5011,
        ),
      },
    ]);
    const out = parseOpcodeList(v, 0, v.byteLength);
    expect(out.warp).not.toBeNull();
    expect(out.warp!.planes).toHaveLength(3);
    expect(out.warp!.planes[0].radial[0]).toBeCloseTo(1.0493, 6);
    expect(out.warp!.planes[2].radial[0]).toBeCloseTo(1.0495, 6);
    expect(out.warp!.centerH).toBeCloseTo(0.4998, 6);
    expect(out.warp!.centerV).toBeCloseTo(0.5011, 6);
    // A one-plane warp answers for all three.
    const one = parseOpcodeList(
      (() => {
        const w = opcodeList([{ id: 1, params: warpParams([[1.02, 0, 0, 0, 0, 0]]) }]);
        return w;
      })(),
      0,
      4 + 16 + (4 + 48 + 16),
    );
    expect(warpPlane(one.warp!, 2).radial[0]).toBeCloseTo(1.02, 6);
  });

  it('reads BIG-endian whatever the TIFF says — the one trap in this format', () => {
    // Written big-endian above; read little-endian, a gain of 1.0 becomes a
    // denormal near 1e-40 rather than something near 1. Asserted by showing
    // the big-endian read lands where it should.
    const v = opcodeList([{ id: 9, params: gainMapParams({ gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }) }]);
    const out = parseOpcodeList(v, 0, v.byteLength);
    expect(out.gainMaps[0].gains[0]).toBe(1);
    // And the raw bytes really are big-endian: the float 1.0 is 3f 80 00 00.
    expect(new Uint8Array(v.buffer)[4 + 16 + 76]).toBe(0x3f);
  });

  it('refuses a CFA-pitch GainMap rather than applying it to every pixel', () => {
    const v = opcodeList([{ id: 9, params: gainMapParams({ rowPitch: 2, colPitch: 2 }) }]);
    const out = parseOpcodeList(v, 0, v.byteLength);
    expect(out.gainMaps).toEqual([]);
    expect(out.unread).toEqual([9]);
  });

  it('names an opcode it does not apply instead of dropping it silently', () => {
    const v = opcodeList([{ id: 3, params: new ArrayBuffer(8) }]);
    expect(parseOpcodeList(v, 0, v.byteLength).unread).toEqual([3]);
  });

  it('keeps what it read when the bytes run out mid-list', () => {
    const v = opcodeList([
      { id: 9, params: gainMapParams() },
      { id: 1, params: warpParams([[1.05, 0, 0, 0, 0, 0]]) },
    ]);
    // Cut the list short of the warp's parameters.
    const out = parseOpcodeList(v, 0, v.byteLength - 20);
    expect(out.gainMaps).toHaveLength(1);
    expect(out.warp).toBeNull();
  });

  it('answers empty for nonsense rather than throwing', () => {
    const v = new DataView(new ArrayBuffer(64));
    expect(parseOpcodeList(v, 0, 2)).toEqual({ gainMaps: [], warp: null, unread: [] });
    expect(parseOpcodeList(v, 60, 40)).toEqual({ gainMaps: [], warp: null, unread: [] });
  });
});

describe('isIdentityWarp', () => {
  it('knows a warp that moves nothing', () => {
    expect(isIdentityWarp(null)).toBe(true);
    expect(isIdentityWarp({ planes: [{ radial: [1, 0, 0, 0], tangential: [0, 0] }], centerH: 0.5, centerV: 0.5 })).toBe(true);
    expect(isIdentityWarp({ planes: [{ radial: [1.05, 0, 0, 0], tangential: [0, 0] }], centerH: 0.5, centerV: 0.5 })).toBe(false);
  });
});

describe('describeOpcodes', () => {
  it('says what the file really asks for', () => {
    const v = opcodeList([
      { id: 9, params: gainMapParams({ gains: [5.93, 5.06, 4.97, 1, 1, 1, 1, 1, 1, 1, 1, 1] }) },
      { id: 1, params: warpParams([[1.0493, 0, 0, 0, 0, 0], [1.0493, 0, 0, 0, 0, 0], [1.0495, 0, 0, 0, 0, 0]]) },
    ]);
    const out = parseOpcodeList(v, 0, v.byteLength);
    expect(describeOpcodes(out)).toBe('gain map 2×2 ×3 · up to 5.93× · warp ×1.049');
  });
});
