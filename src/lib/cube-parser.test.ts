import { describe, expect, it } from 'vitest';
import { parseCube } from './cube-parser';

/** A minimal valid 2×2×2 identity LUT (red varies fastest). */
const IDENTITY_2 = `# Generated for tests
TITLE "Test Identity"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

describe('parseCube', () => {
  it('parses a valid 2×2×2 LUT with the right size and length', () => {
    const lut = parseCube(IDENTITY_2);
    expect(lut).not.toBeNull();
    expect(lut!.size).toBe(2);
    // size**3 * 3 = 8 * 3 = 24 floats.
    expect(lut!.data).toHaveLength(24);
  });

  it('keeps table order with red varying fastest', () => {
    const lut = parseCube(IDENTITY_2)!;
    // Second triplet is (1,0,0): red max, green/blue zero.
    expect(Array.from(lut.data.slice(3, 6))).toEqual([1, 0, 0]);
    // Last triplet is the white corner (1,1,1).
    expect(Array.from(lut.data.slice(21, 24))).toEqual([1, 1, 1]);
  });

  it('parses the TITLE', () => {
    expect(parseCube(IDENTITY_2)!.title).toBe('Test Identity');
  });

  it('defaults the domain to [0,1] when not specified', () => {
    const lut = parseCube(IDENTITY_2)!;
    expect(lut.domainMin).toEqual([0, 0, 0]);
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it('reads an explicit DOMAIN_MIN/DOMAIN_MAX', () => {
    const lut = parseCube(
      `LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n` +
        Array(8).fill('0.5 0.5 0.5').join('\n') +
        '\n',
    )!;
    expect(lut.domainMax).toEqual([1, 1, 1]);
  });

  it('rejects a 1D LUT (out of scope)', () => {
    const lut = parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n');
    expect(lut).toBeNull();
  });

  it('rejects a truncated table (fewer rows than size**3)', () => {
    const truncated = `LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n`;
    expect(parseCube(truncated)).toBeNull();
  });

  it('rejects an overlong table (more rows than size**3)', () => {
    const overlong = IDENTITY_2 + '0.5 0.5 0.5\n';
    expect(parseCube(overlong)).toBeNull();
  });

  it('returns null for empty / non-cube input', () => {
    expect(parseCube('')).toBeNull();
    expect(parseCube('not a cube file at all')).toBeNull();
  });

  it('ignores comments and blank lines', () => {
    const withNoise = `# a comment\n\nLUT_3D_SIZE 2\n\n# another\n` +
      `0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`;
    const lut = parseCube(withNoise);
    expect(lut).not.toBeNull();
    expect(lut!.size).toBe(2);
  });
});
