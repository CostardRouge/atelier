import { describe, expect, it } from 'vitest';
import {
  gatherPcmBytes,
  isPcmType,
  pcmFormat,
  pcmFrameCount,
  pcmWindow,
  type PcmFormat,
  type PcmSound,
} from './pcm-audio';

/** An AudioSampleEntry body (after the 8-byte header), v0, with optional child boxes. */
function entryV0(channels: number, bits: number, rate: number, children: Uint8Array[] = []): Uint8Array {
  const head = new Uint8Array(20);
  const v = new DataView(head.buffer);
  v.setUint16(0, 0);
  v.setUint16(8, channels);
  v.setUint16(10, bits);
  v.setUint32(16, rate * 65536);
  return concat(head, ...children);
}

function box(type: string, payload: number[]): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const S16BE: PcmFormat = { sampleRate: 48000, channels: 2, bits: 16, float: false, littleEndian: false, unsigned: false };

describe('pcmFormat', () => {
  it('reads Sony’s twos as signed 16-bit big-endian stereo at 48 kHz', () => {
    expect(pcmFormat('twos', entryV0(2, 16, 48000))).toEqual(S16BE);
  });

  it('reads sowt as little-endian', () => {
    expect(pcmFormat('sowt', entryV0(2, 16, 48000))?.littleEndian).toBe(true);
  });

  it('reads in24 big-endian by default and little-endian under enda', () => {
    expect(pcmFormat('in24', entryV0(2, 16, 48000))).toMatchObject({ bits: 24, littleEndian: false });
    const wave = box('wave', [...box('enda', [0, 1])]);
    expect(pcmFormat('in24', entryV0(2, 16, 48000, [wave]))).toMatchObject({ bits: 24, littleEndian: true });
  });

  it('skips QuickTime v1’s extension before reading the boxes', () => {
    const e = entryV0(2, 16, 48000, [new Uint8Array(16), box('enda', [0, 1])]);
    new DataView(e.buffer).setUint16(0, 1);
    expect(pcmFormat('in24', e)).toMatchObject({ littleEndian: true, channels: 2 });
  });

  it('reads ipcm’s size and endianness from pcmC', () => {
    const pcmC = box('pcmC', [0, 0, 0, 0, 1, 24]);
    expect(pcmFormat('ipcm', entryV0(4, 16, 48000, [pcmC]))).toMatchObject({
      bits: 24,
      littleEndian: true,
      channels: 4,
      float: false,
    });
  });

  it('reads lpcm’s QuickTime v2 fields', () => {
    const e = new Uint8Array(56);
    const v = new DataView(e.buffer);
    v.setUint16(0, 2);
    v.setUint16(8, 3);
    v.setUint16(10, 16);
    v.setUint32(16, 65536);
    v.setUint32(20, 72);
    v.setFloat64(24, 96000);
    v.setUint32(32, 2);
    v.setUint32(36, 0x7f000000);
    v.setUint32(40, 24);
    v.setUint32(44, 4 | 8); // signed, packed, little-endian
    expect(pcmFormat('lpcm', e)).toEqual({
      sampleRate: 96000,
      channels: 2,
      bits: 24,
      float: false,
      littleEndian: true,
      unsigned: false,
    });
  });

  it('refuses what is not PCM or not playable', () => {
    expect(isPcmType('mp4a')).toBe(false);
    expect(pcmFormat('mp4a', entryV0(2, 16, 48000))).toBeNull();
    expect(pcmFormat('twos', entryV0(2, 12, 48000))).toBeNull();
    expect(pcmFormat('twos', entryV0(0, 16, 48000))).toBeNull();
    expect(pcmFormat('twos', new Uint8Array(10))).toBeNull();
  });
});

describe('gatherPcmBytes', () => {
  const file = Uint8Array.from({ length: 64 }, (_, i) => i);

  it('joins the samples where the table puts them', () => {
    const out = gatherPcmBytes(file, [
      { offset: 10, size: 4 },
      { offset: 14, size: 4 },
      { offset: 40, size: 4 },
    ], 4);
    expect([...out]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 40, 41, 42, 43]);
  });

  it('reads a legacy one-byte-sample chunk whole', () => {
    const samples = [
      { offset: 8, size: 1, chunk_index: 1 },
      { offset: 9, size: 1, chunk_index: 1 },
      { offset: 30, size: 1, chunk_index: 2 },
    ];
    expect([...gatherPcmBytes(file, samples, 4)]).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 30, 31, 32, 33]);
  });
});

describe('pcmWindow', () => {
  /** n stereo frames of s16be: left = i, right = -i (in 1/32768 steps). */
  function sound(n: number, startMicros = 0): PcmSound {
    const bytes = new Uint8Array(n * 4);
    const v = new DataView(bytes.buffer);
    for (let i = 0; i < n; i++) {
      v.setInt16(i * 4, i);
      v.setInt16(i * 4 + 2, -i);
    }
    return { format: { ...S16BE, sampleRate: 1000 }, bytes, startMicros };
  }

  it('decodes a window to planar float on the track’s clock', () => {
    const s = sound(100);
    expect(pcmFrameCount(s)).toBe(100);
    const w = pcmWindow(s, 10_000, 20_000);
    expect(w.length).toBe(10);
    expect(w.numberOfChannels).toBe(2);
    expect(w.getChannelData(0)[0]).toBeCloseTo(10 / 32768, 8);
    expect(w.getChannelData(1)[9]).toBeCloseTo(-19 / 32768, 8);
  });

  it('reads later by the lead and keeps the length', () => {
    const w = pcmWindow(sound(100), 0, 10_000, 5_000);
    expect(w.length).toBe(10);
    expect(w.getChannelData(0)[0]).toBeCloseTo(5 / 32768, 8);
  });

  it('is silent past either end of the recording', () => {
    const w = pcmWindow(sound(10, 5_000), 0, 20_000);
    expect(w.getChannelData(0)[4]).toBe(0);
    expect(w.getChannelData(0)[6]).toBeCloseTo(1 / 32768, 8);
    expect(w.getChannelData(0)[16]).toBe(0);
  });

  it('decodes 24-bit little-endian with its sign', () => {
    const bytes = Uint8Array.from([0xff, 0xff, 0xff, 0x00, 0x00, 0x40]); // -1, +0x400000 (mono)
    const w = pcmWindow(
      { format: { sampleRate: 1000, channels: 1, bits: 24, float: false, littleEndian: true, unsigned: false }, bytes, startMicros: 0 },
      0,
      2_000,
    );
    expect(w.getChannelData(0)[0]).toBeCloseTo(-1 / 8388608, 10);
    expect(w.getChannelData(0)[1]).toBeCloseTo(0.5, 10);
  });

  it('keeps the first two of four channels', () => {
    const bytes = new Uint8Array(8);
    const w = pcmWindow(
      { format: { ...S16BE, channels: 4, sampleRate: 1000 }, bytes, startMicros: 0 },
      0,
      1_000,
    );
    expect(w.numberOfChannels).toBe(2);
  });
});
