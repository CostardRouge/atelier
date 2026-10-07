import { describe, expect, it } from 'vitest';
import { describeDngProfile, PROFILE_TAG as T, readDngProfile } from './dng-profile';
import { parseIfd } from './exif-parser';
import { describeRaw, probeRaw } from './raw-probe';
import { readProfileCurve } from '../develop/profile-curve';
import { isDcp, readDcp } from './dcp';
import { addDcp, dcpProfile, forgetDcp, listDcps } from '../raw/profile-vault';

/**
 * A one-IFD little-endian TIFF written byte by byte, every type a profile
 * uses: ASCII, SHORT, LONG, RATIONAL, SRATIONAL, FLOAT. `cut` truncates the
 * buffer, as the probe's one-megabyte head would truncate a big table.
 */
type Field = { tag: number; type: 2 | 3 | 4 | 5 | 10 | 11; values: number[] | string };
const SIZE = { 2: 1, 3: 2, 4: 4, 5: 8, 10: 8, 11: 4 } as const;

function tiff(fields: Field[], cut?: number): ArrayBuffer {
  const sorted = [...fields].sort((a, b) => a.tag - b.tag);
  const ifdAt = 8;
  let extra = ifdAt + 2 + sorted.length * 12 + 4;
  const total = extra + sorted.reduce((n, f) => n + SIZE[f.type] * (typeof f.values === 'string' ? f.values.length + 1 : f.values.length) + 8, 0);
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  v.setUint16(0, 0x4949, true);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifdAt, true);
  v.setUint16(ifdAt, sorted.length, true);
  sorted.forEach((f, i) => {
    const e = ifdAt + 2 + i * 12;
    const vals = typeof f.values === 'string' ? [...f.values].map((c) => c.charCodeAt(0)).concat(0) : f.values;
    const bytes = SIZE[f.type] * vals.length;
    v.setUint16(e, f.tag, true);
    v.setUint16(e + 2, f.type, true);
    v.setUint32(e + 4, vals.length, true);
    let at = e + 8;
    if (bytes > 4) {
      v.setUint32(e + 8, extra, true);
      at = extra;
      extra += bytes + (bytes % 2);
    }
    vals.forEach((n, k) => {
      const o = at + k * SIZE[f.type];
      if (f.type === 2) v.setUint8(o, n);
      else if (f.type === 3) v.setUint16(o, n, true);
      else if (f.type === 4) v.setUint32(o, n, true);
      else if (f.type === 11) v.setFloat32(o, n, true);
      else if (f.type === 5) {
        v.setUint32(o, Math.round(n * 1e6), true);
        v.setUint32(o + 4, 1e6, true);
      } else {
        v.setInt32(o, Math.round(n * 1e4), true);
        v.setInt32(o + 4, 1e4, true);
      }
    });
  });
  return cut ? buf.slice(0, cut) : buf;
}

const read = (buf: ArrayBuffer) => {
  const view = new DataView(buf);
  return readDngProfile(view, parseIfd(view, 0, view.getUint32(4, true), true), true);
};

const A = [0.812, -0.271, -0.061, -0.457, 1.272, 0.209, -0.082, 0.164, 0.748];
const D65 = [0.7374, -0.2389, -0.0551, -0.5435, 1.3162, 0.2519, -0.1006, 0.1795, 0.6552];
const FM = [0.73, 0.15, 0.085, 0.3, 0.82, -0.12, 0.03, -0.15, 0.945];

const dual: Field[] = [
  { tag: 256, type: 4, values: [64] },
  { tag: T.colorMatrix1, type: 10, values: A },
  { tag: T.colorMatrix2, type: 10, values: D65 },
  { tag: T.forwardMatrix1, type: 10, values: FM },
  { tag: T.forwardMatrix2, type: 10, values: FM },
  { tag: T.illuminant1, type: 3, values: [17] },
  { tag: T.illuminant2, type: 3, values: [21] },
  { tag: T.asShotNeutral, type: 5, values: [0.62, 1, 0.48] },
  { tag: T.profileName, type: 2, values: 'Adobe Standard' },
  { tag: T.embedPolicy, type: 4, values: [1] },
];

describe('readDngProfile', () => {
  it('reads both calibrations with their illuminants, in tag order', () => {
    const p = read(tiff(dual))!;
    expect(p.calibrations.map((c) => c.illuminant)).toEqual([17, 21]);
    expect(p.calibrations[0].colorMatrix![0]).toBeCloseTo(0.812, 4);
    expect(p.calibrations[1].colorMatrix![4]).toBeCloseTo(1.3162, 4);
    expect(p.calibrations[0].forwardMatrix![8]).toBeCloseTo(0.945, 4);
    expect(p.calibrations[0].cameraCalibration).toBeNull();
    expect(p.asShotNeutral![2]).toBeCloseTo(0.48, 5);
    expect(p.name).toBe('Adobe Standard');
    expect(p.embedPolicy).toBe(1);
    expect(p.hueSatMap).toBeNull();
    expect(p.unread).toEqual([]);
  });

  it('is null for a TIFF with no colour data — an ARW is not a DNG', () => {
    expect(read(tiff([{ tag: 256, type: 4, values: [64] }]))).toBeNull();
  });

  it('reads a 2.5D hue/sat map and a look table as floats, and a tone curve as pairs', () => {
    const hs = Array.from({ length: 4 * 2 * 1 * 3 }, (_, i) => i / 10);
    const lt = Array.from({ length: 2 * 2 * 2 * 3 }, (_, i) => 1 + i / 100);
    const p = read(
      tiff([
        ...dual,
        { tag: T.hueSatMapDims, type: 4, values: [4, 2, 1] },
        { tag: T.hueSatMapData1, type: 11, values: hs },
        { tag: T.hueSatMapData2, type: 11, values: hs },
        { tag: T.lookTableDims, type: 4, values: [2, 2, 2] },
        { tag: T.lookTableData, type: 11, values: lt },
        { tag: T.lookTableEncoding, type: 4, values: [1] },
        { tag: T.toneCurve, type: 11, values: [0, 0, 0.5, 0.6, 1, 1] },
      ]),
    )!;
    expect(p.hueSatMap!.dims).toEqual([4, 2, 1]);
    expect(p.hueSatMap!.data![23]).toBeCloseTo(2.3, 5);
    expect(p.hueSatMap!.data2).not.toBeNull();
    expect(p.hueSatMap!.srgbValue).toBe(false);
    expect(p.lookTable!.srgbValue).toBe(true);
    expect(p.lookTable!.data![0]).toBeCloseTo(1, 6);
    expect(p.toneCurve).toEqual([
      [0, 0],
      [0.5, expect.closeTo(0.6, 6)],
      [1, 1],
    ]);
    expect(describeDngProfile(p)).toBe(
      'profile "Adobe Standard" · A + D65 · forward matrices · hue/sat map 4×2×1 · look table 2×2×2 · tone curve',
    );
  });

  it('names a table past the head rather than dropping it', () => {
    const big = Array.from({ length: 90 * 30 * 3 }, () => 1);
    const whole = tiff([...dual, { tag: T.hueSatMapDims, type: 4, values: [90, 30, 1] }, { tag: T.hueSatMapData1, type: 11, values: big }]);
    const p = read(whole.slice(0, whole.byteLength - 4000))!;
    expect(p.hueSatMap!.dims).toEqual([90, 30, 1]);
    expect(p.hueSatMap!.data).toBeNull();
    expect(p.unread).toEqual(['ProfileHueSatMapData1']);
    expect(describeDngProfile(p)).toContain('unread: ProfileHueSatMapData1');
  });

  it('refuses absurd table sizes before allocating', () => {
    const p = read(tiff([...dual, { tag: T.hueSatMapDims, type: 4, values: [100000, 100000, 1] }]))!;
    expect(p.hueSatMap).toBeNull();
  });

  it('says a single matrix, a third illuminant and a gain table map', () => {
    const p = read(
      tiff([
        { tag: T.colorMatrix1, type: 10, values: D65 },
        { tag: T.illuminant1, type: 3, values: [21] },
        { tag: T.illuminant3, type: 3, values: [23] },
        { tag: T.gainTableMap, type: 4, values: [0] },
      ]),
    )!;
    expect(describeDngProfile(p)).toBe('matrix D65 · third illuminant · gain table map');
  });

  it('reaches the probe, which says it at the end of its line', () => {
    const probe = probeRaw(tiff(dual))!;
    expect(probe.profile?.calibrations).toHaveLength(2);
    expect(describeRaw(probe)).toContain('profile "Adobe Standard" · A + D65 · forward matrices');
  });

  it('hands a profile’s tone curve to the base curve, read from the file’s head (C7)', async () => {
    const curved = new File([tiff([...dual, { tag: T.toneCurve, type: 11, values: [0, 0, 0.5, 0.6, 1, 1] }])], 'curved.dng');
    const points = (await readProfileCurve(curved))!;
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 1, y: 1 });
    expect(await readProfileCurve(new File([tiff(dual)], 'plain.dng'))).toBeNull();
    expect(await readProfileCurve(new File([new Uint8Array(16)], 'junk.dng'))).toBeNull();
  });
});

/** A `.dcp`: the same one-IFD TIFF with the camera-profile magic, `IIRC`. */
function dcp(fields: Field[]): ArrayBuffer {
  const buf = tiff(fields);
  new DataView(buf).setUint16(2, 0x4352, true);
  return buf;
}

describe('a loaded camera profile (.dcp, C8)', () => {
  const named = [...dual, { tag: T.profileName, type: 2 as const, values: 'My Body Standard' }];

  it('is read by its magic, through the DNG profile reader, and named', () => {
    const bytes = dcp(named);
    expect(isDcp(bytes)).toBe(true);
    expect(isDcp(tiff(named))).toBe(false);
    const read = readDcp(bytes, 'whatever.dcp')!;
    expect(read.name).toBe('My Body Standard');
    expect(read.profile.calibrations).toHaveLength(2);
    expect(readDcp(dcp(dual), 'Sony ILCE-7CM2 Standard.dcp')!.name).toBe('Adobe Standard');
    expect(readDcp(tiff(named))).toBeNull();
    expect(readDcp(new ArrayBuffer(4))).toBeNull();
  });

  it('is kept under the hash of its bytes, and read back by it', async () => {
    const added = await addDcp(new File([dcp(named)], 'mine.dcp'));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(added.name).toBe('My Body Standard');
    expect((await dcpProfile(added.hash))?.calibrations).toHaveLength(2);
    expect((await listDcps()).map((v) => v.hash)).toContain(added.hash);
    const refused = await addDcp(new File([tiff(named)], 'not-a-dcp.dcp'));
    expect(refused.ok).toBe(false);
    await forgetDcp(added.hash);
    expect(await dcpProfile(added.hash)).toBeNull();
  });
});

