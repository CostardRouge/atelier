import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGET,
  MAX_TARGETS,
  TARGET_PRESETS,
  convertSize,
  decodeEdgeFor,
  describeSize,
  largestSize,
  longEdgeFor,
  readSize,
  readTargets,
  sameTarget,
  targetFolder,
  type ExportTarget,
} from './export-targets';

const landscape = { w: 6000, h: 4000 };
const portrait = { w: 3200, h: 4000 };

describe('a target size, read against the delivered frame', () => {
  it('caps the long edge, and never upscales', () => {
    expect(longEdgeFor({ mode: 'long', value: 2048 }, landscape)).toBe(2048);
    expect(longEdgeFor({ mode: 'long', value: 8000 }, landscape)).toBeNull();
    expect(longEdgeFor(null, landscape)).toBeNull();
  });

  it('turns a short edge into the long edge of THIS shape', () => {
    // 1080 across a 3:2 landscape is 1620 long; across a 4:5 portrait, 1350.
    expect(longEdgeFor({ mode: 'short', value: 1080 }, landscape)).toBe(1620);
    expect(longEdgeFor({ mode: 'short', value: 1080 }, portrait)).toBe(1350);
  });

  it('keeps an area whatever the shape, and a percentage of the frame', () => {
    const edge = longEdgeFor({ mode: 'megapixels', value: 2 }, landscape)!;
    expect(edge * Math.round(edge / 1.5)).toBeGreaterThan(1.99e6);
    expect(edge * Math.round(edge / 1.5)).toBeLessThan(2.01e6);
    expect(longEdgeFor({ mode: 'percent', value: 50 }, landscape)).toBe(3000);
    expect(longEdgeFor({ mode: 'percent', value: 100 }, landscape)).toBeNull();
  });

  it('decodes only as much as every target asks, or whole when a size waits for the shape', () => {
    const t = (size: ExportTarget['size']): ExportTarget => ({ ...DEFAULT_TARGET, size });
    expect(decodeEdgeFor([t({ mode: 'long', value: 2048 }), t({ mode: 'long', value: 4096 })])).toBe(4096);
    expect(decodeEdgeFor([t({ mode: 'long', value: 2048 }), t({ mode: 'short', value: 1080 })])).toBeNull();
    expect(decodeEdgeFor([t(null)])).toBeNull();
  });

  it('knows which target asks the most of a picture', () => {
    const t = (size: ExportTarget['size']): ExportTarget => ({ ...DEFAULT_TARGET, size });
    expect(largestSize([t({ mode: 'long', value: 2048 }), t({ mode: 'short', value: 2000 })])).toEqual({ mode: 'short', value: 2000 });
    expect(largestSize([t({ mode: 'long', value: 2048 }), t(null)])).toBeNull();
  });
});

describe('the record', () => {
  it('reads a v5 roll’s long edge and quality as its one target', () => {
    expect(readTargets(undefined, { longEdge: 2048, quality: 0.8 })).toEqual([{ ...DEFAULT_TARGET, size: { mode: 'long', value: 2048 }, quality: 0.8 }]);
    expect(readTargets(undefined, { longEdge: null })).toEqual([{ ...DEFAULT_TARGET }]);
    expect(readTargets('junk')).toEqual([{ ...DEFAULT_TARGET }]);
  });

  it('reads targets safely: clamped, capped, junk dropped, never empty', () => {
    const many = Array.from({ length: 9 }, () => ({ name: 'W', size: { mode: 'megapixels', value: 999 }, quality: 3, sharpen: 'max' }));
    const read = readTargets([...many, 'junk']);
    expect(read).toHaveLength(MAX_TARGETS);
    expect(read[0]).toEqual({ name: 'W', size: { mode: 'megapixels', value: 200 }, quality: 1, sharpen: 'off', watermark: false });
    expect(readSize({ mode: 'percent', value: 1 })).toEqual({ mode: 'percent', value: 5 });
    expect(readSize({ mode: 'inches', value: 3 })).toBeNull();
  });

  it('compares by value, and says a size in words', () => {
    const web = TARGET_PRESETS.find((p) => p.id === 'web')!.target;
    expect(sameTarget(web, { ...web, size: { mode: 'long', value: 2048 } })).toBe(true);
    expect(sameTarget(web, { ...web, sharpen: 'off' })).toBe(false);
    expect(describeSize(null)).toBe('full size');
    expect(describeSize({ mode: 'short', value: 1080 })).toBe('1080 px short edge');
    expect(describeSize({ mode: 'megapixels', value: 2 })).toBe('2 MP');
  });

  it('names a sub-folder a volume accepts', () => {
    expect(targetFolder('Web', 1)).toBe('Web');
    expect(targetFolder('  a/b:c  ', 1)).toBe('a b c');
    expect(targetFolder('..hidden', 1)).toBe('hidden');
    expect(targetFolder('', 2)).toBe('Target 3');
  });

  it('keeps roughly the same picture when the size changes mode', () => {
    expect(convertSize({ mode: 'long', value: 2048 }, 'short')).toEqual({ mode: 'short', value: 1365 });
    expect(convertSize({ mode: 'short', value: 1080 }, 'long')).toEqual({ mode: 'long', value: 1620 });
    expect(convertSize(null, 'long')).toEqual({ mode: 'long', value: 2048 });
    expect(convertSize({ mode: 'long', value: 2048 }, 'megapixels').value).toBeCloseTo(2.8, 1);
  });
});
