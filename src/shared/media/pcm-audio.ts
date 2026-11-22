/**
 * Linear PCM inside an MP4 — what Sony's XAVC S / XAVC HS cameras record
 * (16- or 24-bit, 48 kHz), and what many other cameras and recorders write.
 *
 * mp4box knows none of PCM's sample entries (`twos`, `sowt`, `in24`, `lpcm`,
 * `ipcm`…): it files them as a bare `SampleEntry`, so the track never reaches
 * `audioTracks` and an export used to go out SILENT without a word. It keeps
 * the entry's raw bytes, though, which is all this needs: the format is read
 * here from those bytes, the frames are gathered from the file once, and any
 * window of them is turned into planar float audio for the encoder.
 *
 * PCM is never copied into the output: mp4-muxer writes AAC or Opus only, and
 * the social platforms ingest AAC. So a PCM clip's sound is the one case the
 * pipeline encodes a clip's own sound without being asked — the alternative
 * is no sound at all.
 *
 * Pure and DOM-free.
 */

import { planar, type PlanarAudio } from './audio-mix';

/** The sample-entry types read here. */
export const PCM_TYPES: readonly string[] = [
  'twos', // signed, big-endian (8 or 16 bit) — Sony's XAVC S
  'sowt', // signed, little-endian
  'raw ', // unsigned 8 bit
  'in24', // 24-bit integer, big-endian unless `enda`
  'in32', // 32-bit integer, big-endian unless `enda`
  'fl32', // 32-bit float, big-endian unless `enda`
  'fl64', // 64-bit float, big-endian unless `enda`
  'lpcm', // QuickTime v2: everything in the description's own fields
  'ipcm', // ISO/IEC 23003-5 integer, `pcmC` says the rest
  'fpcm', // ISO/IEC 23003-5 float, `pcmC` says the rest
];

export function isPcmType(type: string | undefined): boolean {
  return !!type && PCM_TYPES.includes(type);
}

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  /** Bits per sample of one channel. */
  bits: number;
  float: boolean;
  littleEndian: boolean;
  /** Only `raw ` (8-bit) is unsigned. */
  unsigned: boolean;
}

/** A clip's PCM, gathered once at demux: interleaved frames, from `startMicros`. */
export interface PcmSound {
  format: PcmFormat;
  bytes: Uint8Array;
  /** Where the first frame sits on the track's clock, in µs. */
  startMicros: number;
}

/** Bytes of one interleaved frame (every channel's sample). */
export function bytesPerFrame(format: PcmFormat): number {
  return format.channels * (format.bits / 8);
}

/** How many whole frames `sound` holds. */
export function pcmFrameCount(sound: PcmSound): number {
  const stride = bytesPerFrame(sound.format);
  return stride > 0 ? Math.floor(sound.bytes.byteLength / stride) : 0;
}

/** True when 8 bytes at `at` read as a box header (a size and four printable characters). */
function looksLikeBox(view: DataView, at: number): boolean {
  if (at + 8 > view.byteLength) return false;
  const size = view.getUint32(at);
  if (size < 8 || at + size > view.byteLength) return false;
  for (let i = 4; i < 8; i++) {
    const c = view.getUint8(at + i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** The child boxes from `at` on, `wave` opened into its own children. */
function childBoxes(view: DataView, at: number, out = new Map<string, DataView>()): Map<string, DataView> {
  let p = at;
  while (looksLikeBox(view, p)) {
    const size = view.getUint32(p);
    const type = String.fromCharCode(
      view.getUint8(p + 4),
      view.getUint8(p + 5),
      view.getUint8(p + 6),
      view.getUint8(p + 7),
    );
    const body = new DataView(view.buffer, view.byteOffset + p + 8, size - 8);
    if (type === 'wave') childBoxes(body, 0, out);
    else if (!out.has(type)) out.set(type, body);
    p += size;
  }
  return out;
}

/**
 * The format of a PCM sample entry, from its type and the bytes mp4box keeps
 * of it (`SampleEntry.data`: everything after the 8-byte header — version,
 * channels, sample size, rate, then QuickTime's v1/v2 extension and the child
 * boxes). Null when it is not PCM or does not read as anything playable.
 */
export function pcmFormat(type: string, entry: Uint8Array): PcmFormat | null {
  if (!isPcmType(type) || entry.byteLength < 20) return null;
  const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
  const version = view.getUint16(0);
  let channels = view.getUint16(8);
  let bits = view.getUint16(10);
  let sampleRate = view.getUint32(16) / 65536;
  let childrenAt = 20;
  let lpcmFlags: number | null = null;

  if (version === 2 && entry.byteLength >= 56 && view.getUint32(36) === 0x7f000000) {
    // QuickTime SoundDescriptionV2: the real values follow the legacy fields.
    sampleRate = view.getFloat64(24);
    channels = view.getUint32(32);
    bits = view.getUint32(40);
    lpcmFlags = view.getUint32(44);
    childrenAt = 56;
  } else if (version === 1 && !looksLikeBox(view, 20)) {
    // QuickTime SoundDescriptionV1: four more 32-bit fields before the boxes.
    // (An ISO AudioSampleEntryV1 adds none, hence the look at what follows.)
    childrenAt = 36;
  }

  const boxes = childBoxes(view, childrenAt);
  const srat = boxes.get('srat');
  if (srat && srat.byteLength >= 8) sampleRate = srat.getUint32(4);
  const enda = boxes.get('enda');
  const endaLittle = !!enda && enda.byteLength >= 2 && enda.getUint16(0) !== 0;
  const pcmC = boxes.get('pcmC');

  let float = false;
  let littleEndian = false;
  let unsigned = false;
  switch (type) {
    case 'twos':
      break;
    case 'sowt':
      littleEndian = true;
      break;
    case 'raw ':
      unsigned = true;
      bits = 8;
      break;
    case 'in24':
      bits = 24;
      littleEndian = endaLittle;
      break;
    case 'in32':
      bits = 32;
      littleEndian = endaLittle;
      break;
    case 'fl32':
      bits = 32;
      float = true;
      littleEndian = endaLittle;
      break;
    case 'fl64':
      bits = 64;
      float = true;
      littleEndian = endaLittle;
      break;
    case 'lpcm':
      if (lpcmFlags !== null) {
        float = (lpcmFlags & 1) !== 0;
        littleEndian = (lpcmFlags & 2) === 0;
      } else {
        littleEndian = endaLittle;
      }
      break;
    case 'ipcm':
    case 'fpcm':
      float = type === 'fpcm';
      if (pcmC && pcmC.byteLength >= 6) {
        littleEndian = (pcmC.getUint8(4) & 1) !== 0;
        bits = pcmC.getUint8(5);
      }
      break;
  }

  const bitsOk = float ? bits === 32 || bits === 64 : bits === 8 || bits === 16 || bits === 24 || bits === 32;
  if (!bitsOk) return null;
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) return null;
  if (channels < 1 || channels > 32) return null;
  return { sampleRate: Math.round(sampleRate), channels, bits, float, littleEndian, unsigned };
}

/** The little a gather needs of a demuxed sample. */
export interface PcmSampleRef {
  offset: number;
  size: number;
  chunk_index?: number;
}

/**
 * The track's frames, copied out of the file into one interleaved buffer so
 * the file itself can be let go. Samples are read where the sample table puts
 * them, except in QuickTime's legacy layout where every "sample" is declared
 * one byte long whatever a frame weighs: there a chunk is read whole from its
 * first sample's offset, `count × frame bytes` long.
 */
export function gatherPcmBytes(
  file: Uint8Array,
  samples: readonly PcmSampleRef[],
  frameBytes: number,
): Uint8Array {
  const legacy = frameBytes > 1 && samples.length > 0 && samples.every((s) => s.size === 1);
  const ranges: { offset: number; size: number }[] = [];
  if (legacy) {
    let i = 0;
    while (i < samples.length) {
      const first = samples[i];
      let n = 1;
      while (
        i + n < samples.length &&
        (first.chunk_index !== undefined
          ? samples[i + n].chunk_index === first.chunk_index
          : samples[i + n].offset === first.offset + n)
      ) {
        n++;
      }
      ranges.push({ offset: first.offset, size: n * frameBytes });
      i += n;
    }
  } else {
    for (const s of samples) {
      const last = ranges[ranges.length - 1];
      if (last && last.offset + last.size === s.offset) last.size += s.size;
      else ranges.push({ offset: s.offset, size: s.size });
    }
  }
  let total = 0;
  for (const r of ranges) total += Math.max(0, Math.min(r.size, file.byteLength - r.offset));
  const out = new Uint8Array(total);
  let at = 0;
  for (const r of ranges) {
    const size = Math.max(0, Math.min(r.size, file.byteLength - r.offset));
    out.set(file.subarray(r.offset, r.offset + size), at);
    at += size;
  }
  return out;
}

type SampleReader = (view: DataView, at: number) => number;

function readerFor(format: PcmFormat): SampleReader {
  const le = format.littleEndian;
  if (format.float) {
    return format.bits === 64 ? (v, at) => v.getFloat64(at, le) : (v, at) => v.getFloat32(at, le);
  }
  switch (format.bits) {
    case 8:
      return format.unsigned ? (v, at) => (v.getUint8(at) - 128) / 128 : (v, at) => v.getInt8(at) / 128;
    case 16:
      return (v, at) => v.getInt16(at, le) / 32768;
    case 24:
      return le
        ? (v, at) => (((v.getUint8(at + 2) << 24) | (v.getUint8(at + 1) << 16) | (v.getUint8(at) << 8)) >> 8) / 8388608
        : (v, at) => (((v.getUint8(at) << 24) | (v.getUint8(at + 1) << 16) | (v.getUint8(at + 2) << 8)) >> 8) / 8388608;
    default:
      return (v, at) => v.getInt32(at, le) / 2147483648;
  }
}

/** Channels delivered: AAC and the platforms take stereo; extra channels are left out. */
export const MAX_DELIVERED_CHANNELS = 2;

/**
 * `[fromMicros, untilMicros)` of the clip's sound as planar float audio, on
 * the same clock as the track's frames. `leadMicros` reads the window that
 * much LATER while keeping its length — the AAC encoder's priming, taken off
 * the front exactly as `decodeAacWindow` does, so the sound lands on its
 * picture. Past either end of the recording is silence. Only the first
 * {@link MAX_DELIVERED_CHANNELS} channels are kept (a Sony 4-channel file
 * carries its main pair first).
 */
export function pcmWindow(
  sound: PcmSound,
  fromMicros: number,
  untilMicros: number,
  leadMicros = 0,
): PlanarAudio {
  const { format, bytes } = sound;
  const rate = format.sampleRate;
  const length = Math.max(1, Math.ceil(((untilMicros - fromMicros) / 1_000_000) * rate));
  const kept = Math.min(format.channels, MAX_DELIVERED_CHANNELS);
  const channels = Array.from({ length: kept }, () => new Float32Array(length));
  const first = Math.round(((fromMicros + leadMicros - sound.startMicros) / 1_000_000) * rate);
  const total = pcmFrameCount(sound);
  const stride = bytesPerFrame(format);
  const width = format.bits / 8;
  const read = readerFor(format);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const from = Math.max(0, -first);
  const to = Math.min(length, total - first);
  for (let k = from; k < to; k++) {
    const base = (first + k) * stride;
    for (let c = 0; c < kept; c++) channels[c][k] = read(view, base + c * width);
  }
  return planar(rate, channels);
}
