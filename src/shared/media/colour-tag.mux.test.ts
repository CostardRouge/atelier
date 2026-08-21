/**
 * The guard's one dangerous failure mode is over-zealousness: if it stripped
 * the colour space our exports really carry, we would silently LOSE the `colr`
 * box that mp4-muxer writes for us today. Pure unit tests cannot catch that —
 * only muxing a real file can. So this drives mp4-muxer itself.
 *
 * It is deliberately coupled to the library's behaviour: if a future version
 * stops writing `colr`, or changes what it accepts, this test is how we find
 * out rather than shipping untagged exports.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { safeChunkMetadata } from './colour-tag';

/** What Chrome reports for a canvas-sourced frame — measured, not assumed. */
const REAL: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
};

/** A minimal AVC decoder description; mp4-muxer only copies these bytes. */
const DESCRIPTION = new Uint8Array([
  1, 66, 0, 31, 255, 225, 0, 4, 103, 66, 0, 31, 1, 0, 4, 104, 206, 60, 128,
]);

interface Colr {
  type: string;
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: number;
}

/** Find the colr box in a muxed file and read its nclx fields. */
function readColr(buf: Uint8Array): Colr | null {
  for (let i = 0; i + 15 < buf.length; i += 1) {
    if (buf[i] === 0x63 && buf[i + 1] === 0x6f && buf[i + 2] === 0x6c && buf[i + 3] === 0x72) {
      const d = buf.subarray(i + 4);
      const be16 = (o: number) => (d[o] << 8) | d[o + 1];
      return {
        type: String.fromCharCode(d[0], d[1], d[2], d[3]),
        primaries: be16(4),
        transfer: be16(6),
        matrix: be16(8),
        fullRange: d[10] >> 7,
      };
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Muxer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ArrayBufferTarget: any;

beforeAll(async () => {
  // mp4-muxer type-checks chunks against a global the node environment lacks.
  (globalThis as unknown as { EncodedVideoChunk: unknown }).EncodedVideoChunk =
    class {
      constructor(init: object) {
        Object.assign(this, init);
      }
    };
  const mod = await import('mp4-muxer');
  Muxer = mod.Muxer;
  ArrayBufferTarget = mod.ArrayBufferTarget;
});

function mux(colorSpace: VideoColorSpaceInit | undefined): Uint8Array {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: 320, height: 180 },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'cross-track-offset',
  });
  const meta = {
    decoderConfig: {
      codec: 'avc1.42001f',
      codedWidth: 320,
      codedHeight: 180,
      description: DESCRIPTION,
      ...(colorSpace ? { colorSpace } : {}),
    } as VideoDecoderConfig,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chunk = new (globalThis as any).EncodedVideoChunk({
    type: 'key',
    timestamp: 0,
    duration: 33333,
    byteLength: 4,
    copyTo: (d: Uint8Array) => d.set([0, 0, 0, 1]),
  });
  muxer.addVideoChunk(chunk, safeChunkMetadata(meta));
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}

describe('the guard against a real muxer', () => {
  it('still writes the correct colr box for what Chrome reports', () => {
    // The regression that matters: the guard must NOT cost us the tag we
    // already have. bt709 = 1 for all three ISO fields; 0 = limited range.
    expect(readColr(mux(REAL))).toEqual({
      type: 'nclx',
      primaries: 1,
      transfer: 1,
      matrix: 1,
      fullRange: 0,
    });
  });

  it('writes no box at all rather than a wrong one', () => {
    // Unguarded, mp4-muxer would write matrix=0 here — Identity/RGB, an
    // active and wrong claim. Absent is the correct outcome.
    const exotic = { ...REAL, matrix: 'bt2020-ncl' } as unknown as VideoColorSpaceInit;
    expect(readColr(mux(exotic))).toBeNull();
  });

  it('writes no box when the encoder reported no colour space', () => {
    expect(readColr(mux(undefined))).toBeNull();
  });
});
