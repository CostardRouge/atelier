import { describe, expect, it } from 'vitest';
import { isEncodableColorSpace, safeChunkMetadata } from './colour-tag';

/** What Chrome actually reports for a canvas-sourced frame — measured. */
const REAL: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
};

/**
 * Values outside WebCodecs' own enums. The typings cannot express `pq`, `hlg`
 * or `bt2020` at all — which is exactly why the guard has to exist at runtime:
 * a browser reporting them would be a surprise TypeScript never sees coming.
 */
const exotic = (over: Record<string, unknown>): VideoColorSpaceInit =>
  ({ ...REAL, ...over }) as unknown as VideoColorSpaceInit;

/** REAL minus one field, built without an unused binding. */
const without = (key: keyof VideoColorSpaceInit): VideoColorSpaceInit => {
  const copy: Record<string, unknown> = { ...REAL };
  delete copy[key];
  return copy as VideoColorSpaceInit;
};

const meta = (colorSpace?: VideoColorSpaceInit | null) => ({
  decoderConfig: {
    codec: 'avc1.42001f',
    codedWidth: 1920,
    codedHeight: 1080,
    description: new Uint8Array([1, 2, 3]),
    ...(colorSpace === undefined ? {} : { colorSpace }),
  } as VideoDecoderConfig,
});

describe('isEncodableColorSpace', () => {
  it('accepts the colour space Chrome reports for our exports', () => {
    expect(isEncodableColorSpace(REAL)).toBe(true);
  });

  it('accepts every combination the muxer can write', () => {
    for (const primaries of ['bt709', 'bt470bg', 'smpte170m'] as const)
      for (const transfer of ['bt709', 'smpte170m', 'iec61966-2-1'] as const)
        for (const matrix of ['rgb', 'bt709', 'bt470bg', 'smpte170m'] as const)
          expect(
            isEncodableColorSpace({ primaries, transfer, matrix, fullRange: true }),
          ).toBe(true);
  });

  it('rejects values the muxer would silently write as 0', () => {
    // bt2020 / PQ / HLG are the realistic ones: HDR footage, or a browser
    // that starts reporting more than the three values it does today.
    expect(isEncodableColorSpace(exotic({ primaries: 'bt2020' }))).toBe(false);
    expect(isEncodableColorSpace(exotic({ transfer: 'pq' }))).toBe(false);
    expect(isEncodableColorSpace(exotic({ transfer: 'hlg' }))).toBe(false);
    expect(isEncodableColorSpace(exotic({ matrix: 'bt2020-ncl' }))).toBe(false);
  });

  it('rejects a PARTIAL colour space — the Identity trap', () => {
    // A missing matrix is not "unspecified": mp4-muxer writes 0, which means
    // Identity/RGB, an active and wrong claim.
    expect(isEncodableColorSpace(without('matrix'))).toBe(false);
    expect(isEncodableColorSpace(without('primaries'))).toBe(false);
    expect(isEncodableColorSpace(without('transfer'))).toBe(false);
  });

  it('rejects a missing or non-boolean full-range flag', () => {
    // Absent becomes 0 = limited, which is a guess; guessing range wrong is a
    // visible contrast error, not a subtle one.
    expect(isEncodableColorSpace(without('fullRange'))).toBe(false);
    expect(isEncodableColorSpace({ ...REAL, fullRange: null })).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isEncodableColorSpace(null)).toBe(false);
    expect(isEncodableColorSpace(undefined)).toBe(false);
  });
});

describe('safeChunkMetadata', () => {
  it('passes the real case straight through, unchanged', () => {
    const m = meta(REAL);
    expect(safeChunkMetadata(m)).toBe(m);
  });

  it('is a no-op when there is nothing to guard', () => {
    expect(safeChunkMetadata(undefined)).toBeUndefined();
    const bare = { decoderConfig: undefined };
    expect(safeChunkMetadata(bare)).toBe(bare);
    const noColour = meta();
    expect(safeChunkMetadata(noColour)).toBe(noColour);
  });

  it('strips an unencodable colour space, keeping the rest of the config', () => {
    const m = meta(exotic({ matrix: 'bt2020-ncl' }));
    const safe = safeChunkMetadata(m)!;
    expect(safe).not.toBe(m);
    expect('colorSpace' in safe.decoderConfig!).toBe(false);
    // Everything the muxer actually needs must survive.
    expect(safe.decoderConfig!.codec).toBe('avc1.42001f');
    expect(safe.decoderConfig!.codedWidth).toBe(1920);
    expect(safe.decoderConfig!.codedHeight).toBe(1080);
    expect(safe.decoderConfig!.description).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('never mutates its argument', () => {
    // mp4-muxer Object.assigns this into state it keeps until finalize(), and
    // the object belongs to the browser.
    const cs = exotic({ transfer: 'pq' });
    const m = meta(cs);
    safeChunkMetadata(m);
    expect(m.decoderConfig.colorSpace).toEqual(cs);
  });

  it('strips a null colour space too', () => {
    const safe = safeChunkMetadata(meta(null))!;
    expect('colorSpace' in safe.decoderConfig!).toBe(false);
  });
});
