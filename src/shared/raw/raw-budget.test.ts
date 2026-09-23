import { describe, expect, it } from 'vitest';
import {
  CONSTRAINED_EXPORT_EDGE,
  CONSTRAINED_STAGE_EDGE,
  decodedBytes,
  decodedCacheCeiling,
  decoderIdleMs,
  rawDecodeCap,
  rawDecodeEdge,
} from './raw-budget';

describe('rawDecodeEdge', () => {
  it('leaves a roomy device to the GPU’s cap alone', () => {
    expect(rawDecodeEdge('stage', 'roomy', 16384)).toBe(16384);
    expect(rawDecodeEdge('export', 'roomy', 8192)).toBe(8192);
    expect(rawDecodeEdge('loupe', 'roomy', Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it('caps a constrained device by purpose, under the GPU where the GPU is smaller', () => {
    expect(rawDecodeEdge('stage', 'constrained', 16384)).toBe(CONSTRAINED_STAGE_EDGE);
    expect(rawDecodeEdge('loupe', 'constrained', 16384)).toBe(CONSTRAINED_STAGE_EDGE);
    expect(rawDecodeEdge('export', 'constrained', 16384)).toBe(CONSTRAINED_EXPORT_EDGE);
    expect(rawDecodeEdge('export', 'constrained', 2048)).toBe(2048);
    // A GPU that answered nothing sensible is no cap at all.
    expect(rawDecodeEdge('stage', 'constrained', 0)).toBe(CONSTRAINED_STAGE_EDGE);
  });

  it('a DJI DNG at LibRaw’s half lands at 2016 on a phone’s stage and 4032 in its export', () => {
    // The decoder box-averages by ceil(edge / max): the same arithmetic, pinned here.
    const half = 4032;
    expect(Math.ceil(half / rawDecodeEdge('stage', 'constrained', 16384))).toBe(2);
    expect(Math.ceil(half / rawDecodeEdge('export', 'constrained', 16384))).toBe(1);
  });
});

describe('rawDecodeCap', () => {
  it('names which limit a long edge ran into', () => {
    expect(rawDecodeCap(4032, 'stage', 'constrained', 16384)).toBe('device');
    expect(rawDecodeCap(2016, 'stage', 'constrained', 16384)).toBe(null);
    expect(rawDecodeCap(9504, 'export', 'roomy', 8192)).toBe('gpu');
    expect(rawDecodeCap(9504, 'export', 'constrained', 8192)).toBe('device');
    // A GPU smaller than the device's own ceiling is the GPU's fault.
    expect(rawDecodeCap(4032, 'stage', 'constrained', 2048)).toBe('gpu');
  });
});

describe('the rest of the budget', () => {
  it('holds less decoded RAW on a phone, and counts a decode’s bytes honestly', () => {
    expect(decodedCacheCeiling('constrained')).toBe(64 * 1024 * 1024);
    expect(decodedCacheCeiling('roomy')).toBe(256 * 1024 * 1024);
    // A DJI stage decode: 2016 × 1134 at six bytes for the GPU and four for the canvas.
    expect(decodedBytes(2016, 1134, true)).toBe(2016 * 1134 * 10);
    expect(decodedBytes(2016, 1134, false)).toBe(2016 * 1134 * 6);
    expect(decodedBytes(0, 10, true)).toBe(0);
  });

  it('lets a phone’s decoder go after a rest, and keeps a desktop’s', () => {
    expect(decoderIdleMs('constrained')).toBe(8000);
    expect(decoderIdleMs('roomy')).toBe(null);
  });
});
