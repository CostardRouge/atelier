import { describe, expect, it } from 'vitest';
import type { CubeLut } from '../lib/cube-parser';
import { makeCubePass } from './cube-pass';

const lut = { size: 2, data: new Float32Array(24), domainMin: [0, 0, 0], domainMax: [1, 1, 1], title: 't' } as unknown as CubeLut;

/** What the pass hands the GPU: its uniforms, read from a recording context. */
function uniforms(pass: ReturnType<typeof makeCubePass>): Record<string, number> {
  const out: Record<string, number> = {};
  const gl = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === 'getUniformLocation') return (_p: unknown, n: string) => n;
        if (name === 'uniform1f' || name === 'uniform1i') return (loc: string, v: number) => (out[loc] = v);
        if (name === 'createTexture') return () => null;
        return () => null;
      },
    },
  ) as unknown as WebGL2RenderingContext;
  try {
    pass.setUniforms?.(gl, {} as WebGLProgram);
  } catch {
    // The texture upload needs a real context; the uniforms before it are what is read.
  }
  return out;
}

describe('the cube pass at another strength', () => {
  it('keeps its look, draws at the new strength, and says so in its key', () => {
    const half = makeCubePass({ lut, intensity: 1 });
    const next = half.withIntensity(0.4);
    expect(uniforms(next).u_intensity).toBeCloseTo(0.4, 9);
    expect(uniforms(next).u_hasLut).toBe(1);
    expect(next.key).not.toBe(half.key);
    expect(next.key).toContain(':0.4:');
  });
});
