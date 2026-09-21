import { describe, expect, it } from 'vitest';
import {
  describeCompression,
  describeRaw,
  extractRawPreview,
  probeRaw,
  sensorIfd,
} from './raw-probe';

/**
 * A hand-built little-endian TIFF, the EXIF parser's own tradition: a real
 * camera RAW is 60 MB of somebody's photograph and belongs nowhere near the
 * repository, so the structure is written byte by byte here and every claim
 * the probe makes is checked against bytes we chose.
 */
interface Field {
  tag: number;
  /** 3 = SHORT, 4 = LONG. */
  type: 3 | 4;
  values: number[];
}

function buildTiff(ifds: { fields: Field[]; subIfdIndexes?: number[] }[], trailing = 0): ArrayBuffer {
  // Layout: header, then each IFD in order, then the overflow values, then the
  // pixel payloads. Offsets are resolved in a second pass.
  const HEADER = 8;
  const ifdSizes = ifds.map((i) => 2 + (i.fields.length + (i.subIfdIndexes ? 1 : 0)) * 12 + 4);
  const ifdOffsets: number[] = [];
  let at = HEADER;
  for (const size of ifdSizes) {
    ifdOffsets.push(at);
    at += size;
  }
  const overflowStart = at;
  // Values longer than four bytes live after the IFDs.
  const overflow: number[] = [];
  const buffer = new ArrayBuffer(overflowStart + 4096 + trailing);
  const view = new DataView(buffer);

  view.setUint16(0, 0x4949, true); // "II"
  view.setUint16(2, 0x002a, true);
  view.setUint32(4, ifdOffsets[0], true);

  let overflowAt = overflowStart;
  const writeField = (entryAt: number, tag: number, type: 3 | 4, values: number[]) => {
    view.setUint16(entryAt, tag, true);
    view.setUint16(entryAt + 2, type, true);
    view.setUint32(entryAt + 4, values.length, true);
    const size = type === 3 ? 2 : 4;
    if (values.length * size <= 4) {
      values.forEach((v, i) =>
        type === 3 ? view.setUint16(entryAt + 8 + i * 2, v, true) : view.setUint32(entryAt + 8, v, true),
      );
    } else {
      view.setUint32(entryAt + 8, overflowAt, true);
      values.forEach((v, i) =>
        type === 3
          ? view.setUint16(overflowAt + i * 2, v, true)
          : view.setUint32(overflowAt + i * 4, v, true),
      );
      overflowAt += values.length * size;
      overflow.push(overflowAt);
    }
  };

  ifds.forEach((ifd, index) => {
    const base = ifdOffsets[index];
    const fields = [...ifd.fields];
    if (ifd.subIfdIndexes) {
      fields.push({ tag: 330, type: 4, values: ifd.subIfdIndexes.map((i) => ifdOffsets[i]) });
    }
    fields.sort((a, b) => a.tag - b.tag);
    view.setUint16(base, fields.length, true);
    fields.forEach((f, i) => writeField(base + 2 + i * 12, f.tag, f.type, f.values));
    // Only IFD0 chains on, and only to nothing here.
    view.setUint32(base + 2 + fields.length * 12, 0, true);
  });

  return buffer;
}

const SHORT = 3 as const;
const LONG = 4 as const;

/** A DNG shaped like a drone's: a small thumbnail in IFD0, the sensor plane and
 *  a full-size JPEG render in SubIFDs, plus an opcode list. */
function droneDng(previewOffset = 8000, previewLength = 1200): ArrayBuffer {
  return buildTiff([
    {
      // IFD0: the thumbnail render.
      fields: [
        { tag: 254, type: LONG, values: [1] },
        { tag: 256, type: SHORT, values: [256] },
        { tag: 257, type: SHORT, values: [171] },
        { tag: 259, type: SHORT, values: [7] },
        { tag: 262, type: SHORT, values: [6] },
        { tag: 513, type: LONG, values: [6000] },
        { tag: 514, type: LONG, values: [400] },
        { tag: 51008, type: LONG, values: [1] }, // an opcode list
      ],
      subIfdIndexes: [1, 2],
    },
    {
      // SubIFD 0: the sensor plane — lossless JPEG, CFA. NOT a preview.
      fields: [
        { tag: 254, type: LONG, values: [0] },
        { tag: 256, type: SHORT, values: [8064] },
        { tag: 257, type: SHORT, values: [6048] },
        { tag: 259, type: SHORT, values: [7] },
        { tag: 262, type: SHORT, values: [32803] },
        { tag: 273, type: LONG, values: [20000] },
        { tag: 279, type: LONG, values: [3000] },
      ],
    },
    {
      // SubIFD 1: the camera's full-size render.
      fields: [
        { tag: 254, type: LONG, values: [1] },
        { tag: 256, type: SHORT, values: [4032] },
        { tag: 257, type: SHORT, values: [3024] },
        { tag: 259, type: SHORT, values: [7] },
        { tag: 262, type: SHORT, values: [6] },
        { tag: 513, type: LONG, values: [previewOffset] },
        { tag: 514, type: LONG, values: [previewLength] },
      ],
    },
  ]);
}

describe('probeRaw', () => {
  it('refuses anything that is not a TIFF', () => {
    expect(probeRaw(new ArrayBuffer(4))).toBeNull();
    const jpeg = new ArrayBuffer(32);
    new DataView(jpeg).setUint16(0, 0xffd8, false);
    expect(probeRaw(jpeg)).toBeNull();
  });

  it('walks into the SubIFDs, where a DNG keeps the picture that matters', () => {
    const probe = probeRaw(droneDng())!;
    expect(probe).not.toBeNull();
    expect(probe.little).toBe(true);
    // IFD0 plus two SubIFDs — reading IFD0 alone would find the thumbnail only.
    expect(probe.ifds).toHaveLength(3);
    expect(probe.ifds[1].width).toBe(8064);
  });

  it('picks the FULL-SIZE render, not the thumbnail', () => {
    const probe = probeRaw(droneDng())!;
    expect(probe.preview).toEqual({ offset: 8000, length: 1200, width: 4032, height: 3024 });
  });

  it('never mistakes the sensor plane for a preview, though it is JPEG too', () => {
    // The trap this rule exists for: a DNG's CFA plane is compression 7 as
    // well, and handing those bytes to a browser gives a mosaic, not a picture.
    const probe = probeRaw(droneDng())!;
    expect(probe.preview!.offset).not.toBe(20000);
    expect(sensorIfd(probe)!.photometric).toBe(32803);
    expect(sensorIfd(probe)!.width).toBe(8064);
  });

  it('reports the opcode lists a naive decode would skip', () => {
    expect(probeRaw(droneDng())!.opcodes).toEqual([51008]);
  });

  it('keeps a preview that sits far past the head it was read from', () => {
    // The bug this pins: the probe sees only the first megabyte, and a
    // full-size render in a 60 MB DNG lives well beyond it. Bounds-checking
    // here would throw away the one preview worth having.
    const probe = probeRaw(droneDng(45_000_000, 4_000_000))!;
    expect(probe.preview).toEqual({
      offset: 45_000_000,
      length: 4_000_000,
      width: 4032,
      height: 3024,
    });
  });

  it('answers no preview for a file that carries only a sensor plane', () => {
    const bare = buildTiff([
      {
        fields: [
          { tag: 256, type: SHORT, values: [6000] },
          { tag: 257, type: SHORT, values: [4000] },
          { tag: 259, type: SHORT, values: [52546] }, // JPEG XL tiles
          { tag: 262, type: SHORT, values: [32803] },
          { tag: 273, type: LONG, values: [900] },
          { tag: 279, type: LONG, values: [500] },
        ],
      },
    ]);
    const probe = probeRaw(bare)!;
    expect(probe.preview).toBeNull();
    expect(describeRaw(probe)).toBe('6000×4000 · sensor JPEG XL · no embedded preview');
  });
});

describe('the calibration, read through the probe', () => {
  it('reads OpcodeList3 out of a DNG head and says what it asks for', () => {
    // A minimal TIFF whose IFD0 carries tag 51022 (OpcodeList3) with one
    // GainMap: 1 plane, a 2x2 grid whose corner asks for 5.93x.
    const gains = [5.93, 1, 1, 1];
    const params = new ArrayBuffer(76 + gains.length * 4);
    const pv = new DataView(params);
    [0, 0, 4536, 8064, 0, 3, 1, 1, 2, 2].forEach((n, i) => pv.setUint32(i * 4, n, false));
    pv.setFloat64(40, 1, false);
    pv.setFloat64(48, 1, false);
    pv.setFloat64(56, 0, false);
    pv.setFloat64(64, 0, false);
    pv.setUint32(72, 1, false);
    gains.forEach((g, i) => pv.setFloat32(76 + i * 4, g, false));

    const list = new ArrayBuffer(4 + 16 + params.byteLength);
    const lv = new DataView(list);
    lv.setUint32(0, 1, false);
    lv.setUint32(4, 9, false);
    lv.setUint32(16, params.byteLength, false);
    new Uint8Array(list).set(new Uint8Array(params), 20);

    const OP_AT = 256;
    const buf = new ArrayBuffer(OP_AT + list.byteLength);
    const v = new DataView(buf);
    v.setUint16(0, 0x4949, false);
    v.setUint16(2, 42, true);
    v.setUint32(4, 8, true);
    v.setUint16(8, 1, true); // one entry
    v.setUint16(10, 51022, true);
    v.setUint16(12, 7, true); // UNDEFINED
    v.setUint32(14, list.byteLength, true);
    v.setUint32(18, OP_AT, true);
    v.setUint32(22, 0, true);
    new Uint8Array(buf).set(new Uint8Array(list), OP_AT);

    const probe = probeRaw(buf);
    expect(probe?.opcodes).toEqual([51022]);
    expect(probe?.calibration?.gainMaps).toHaveLength(1);
    expect(probe?.calibration?.gainMaps[0].gains[0]).toBeCloseTo(5.93, 2);
    expect(describeRaw(probe!)).toContain('gain map 2×2 ×1 · up to 5.93×');
  });
});

describe('describeCompression and describeRaw', () => {
  it('names the codes that decide the decoder question', () => {
    expect(describeCompression(52546)).toBe('JPEG XL');
    expect(describeCompression(7)).toBe('JPEG');
    expect(describeCompression(1)).toBe('uncompressed');
    expect(describeCompression(34892)).toBe('lossy JPEG');
    expect(describeCompression(undefined)).toBe('unstated');
    expect(describeCompression(999)).toBe('compression 999');
  });

  it('says what a file is in one line', () => {
    expect(describeRaw(probeRaw(droneDng())!)).toBe(
      '8064×6048 · sensor JPEG · preview 4032×3024 · 1 opcode list',
    );
  });
});

describe('extractRawPreview', () => {
  /** A blob whose bytes past the header are a recognisable run. */
  const fileOf = (buffer: ArrayBuffer, size: number): Blob => {
    const bytes = new Uint8Array(size);
    bytes.set(new Uint8Array(buffer).slice(0, Math.min(buffer.byteLength, size)));
    for (let i = 8000; i < Math.min(size, 9200); i += 1) bytes[i] = 0xab;
    return new Blob([bytes]);
  };

  it('slices the camera’s own render out, without reading the whole file', async () => {
    const blob = fileOf(droneDng(), 60_000);
    const preview = await extractRawPreview(blob);
    expect(preview).not.toBeNull();
    expect(preview!.size).toBe(1200);
    expect(preview!.type).toBe('image/jpeg');
    const first = new Uint8Array(await preview!.slice(0, 1).arrayBuffer())[0];
    expect(first).toBe(0xab);
  });

  it('answers null rather than an empty blob when the pointer is past the file', async () => {
    // A truncated or malformed RAW: no preview beats a blob that fails to
    // decode three layers later with nothing to say.
    const blob = fileOf(droneDng(45_000_000, 4_000_000), 60_000);
    expect(await extractRawPreview(blob)).toBeNull();
  });

  it('answers null for a file that is not a RAW at all', async () => {
    expect(await extractRawPreview(new Blob([new Uint8Array(64)]))).toBeNull();
  });
});
