/**
 * The LOOK, as a pass of the render core — node 6 of `docs/photo-editor.md` §5,
 * and node 2 when it carries a develop.
 *
 * It is the very lookup `lut-gl.ts` runs, from the same GLSL chunk: the cube
 * SURVIVES the new core rather than being replaced by it, which is the claim
 * the whole plan rests on. A picture with nothing but a look therefore comes
 * out of the graph pixel-identical to the old renderer, and everything that
 * already takes exactly one `CubeLut` keeps working.
 */

import type { CubeLut } from '../lib/cube-parser';
import type { Interpolation } from '../lut/interpolate';
import { GLSL_VERSION, LUT_LOOKUP, LUT_UNIFORMS } from './glsl';
import type { RenderPass } from './graph';

const FRAGMENT = `${GLSL_VERSION}
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
${LUT_UNIFORMS}
${LUT_LOOKUP}

void main() {
  vec4 src = texture(u_src, v_uv);
  outColor = vec4(gradeThroughLut(src.rgb), src.a);
}`;

export interface CubePassOptions {
  lut: CubeLut | null;
  /** 0 = original, 1 = the look as authored, above 1 extrapolates past it. */
  intensity?: number;
  interpolation?: Interpolation;
}

/**
 * A cube pass, with its 3D texture uploaded once per `lut` object.
 *
 * The texture is kept on the GL context the graph owns, keyed by identity: a
 * caller re-rendering the same look every frame pays one upload, and a changed
 * cube is a new object (`composeLutStack` always returns one), so identity is
 * the right key and a version counter would only be a second thing to get
 * wrong.
 */
export function makeCubePass(options: CubePassOptions): RenderPass {
  const { lut, intensity = 1, interpolation = 'tetrahedral' } = options;
  let uploaded: { gl: WebGL2RenderingContext; tex: WebGLTexture; lut: CubeLut | null } | null = null;

  return {
    id: 'cube',
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      const hasLut = Boolean(lut);
      gl.uniform1i(gl.getUniformLocation(program, 'u_hasLut'), hasLut ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), intensity);
      gl.uniform1i(
        gl.getUniformLocation(program, 'u_tetra'),
        interpolation === 'tetrahedral' ? 1 : 0,
      );
      gl.uniform1f(gl.getUniformLocation(program, 'u_lutSize'), lut?.size ?? 2);
      gl.uniform3f(gl.getUniformLocation(program, 'u_domainMin'), ...(lut?.domainMin ?? [0, 0, 0]));
      gl.uniform3f(gl.getUniformLocation(program, 'u_domainMax'), ...(lut?.domainMax ?? [1, 1, 1]));

      if (!uploaded || uploaded.lut !== lut || uploaded.gl !== gl) {
        if (uploaded && uploaded.gl === gl) gl.deleteTexture(uploaded.tex);
        const tex = createCubeTexture(gl, lut);
        if (!tex) return;
        uploaded = { gl, tex, lut };
      } else {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, uploaded.tex);
      }
      gl.uniform1i(gl.getUniformLocation(program, 'u_lut'), 1);
      // Put the unit back, or the NEXT pass's `u_src` binding lands on unit 1.
      gl.activeTexture(gl.TEXTURE0);
    },
  };
}

/**
 * A cube as a 3D texture on unit 1, made and filled — what every pass that
 * grades needs, and the one place the two traps below are answered.
 *
 * **A `sampler3D` is bound EVEN WITH NO LOOK**, to a 1-texel placeholder. Left
 * unset it defaults to unit 0, where the `sampler2D` source already is, and two
 * sampler types on one unit is INVALID_OPERATION at draw time: the whole pass
 * is dropped and the canvas stays black. Measured — the core's first run drew
 * nothing, with GL error 1282 and no exception.
 *
 * The caller owns the texture and must delete it; the unit is left on 0, or the
 * NEXT pass's `u_src` binding would land on unit 1.
 */
export function createCubeTexture(
  gl: WebGL2RenderingContext,
  lut: CubeLut | null,
): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, tex);
  // `texImage3D` errors if FLIP_Y is left on from the source upload.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  uploadCube(gl, lut);
  gl.activeTexture(gl.TEXTURE0);
  return tex;
}

/**
 * The internal format a cube is stored in on this GPU — always FLOAT, never
 * 8-bit.
 *
 * `RGBA32F` where the GPU can FILTER it (`OES_texture_float_linear`), else
 * `RGBA16F`, which is texture-filterable in core WebGL2 and takes the very
 * same `FLOAT` upload — the driver converts. Without the extension an
 * `RGBA32F` texture set to LINEAR is INCOMPLETE, and an incomplete texture
 * samples black: no error, no exception, a black picture. `lut-gl.ts` had
 * always branched here to `RGBA8`, and that branch CLAMPED the cube's output
 * to [0,1] and quantised it to 8 bits — which threw away a conversion LUT's
 * highlight rolloff above white (the shipped DJI cube is `#Not-Clipped.`) on
 * every GPU that took it. Half-float keeps the headroom and about 11 bits in
 * [0,1], a fraction of an 8-bit code; the gate forces this path on purpose.
 */
export function cubeInternalFormat(gl: WebGL2RenderingContext): GLenum {
  return gl.getExtension('OES_texture_float_linear') ? gl.RGBA32F : gl.RGBA16F;
}

/**
 * The cube's texels, into whatever 3D texture is bound on the active unit.
 *
 * ONE upload for both shaders — `lut-gl.ts` and the cube pass — exactly as the
 * lookup is one GLSL chunk: two copies of this loop is how a preview and an
 * export come to disagree. The caller sets the texture's parameters and the
 * unpack state (`UNPACK_FLIP_Y_WEBGL` off, or `texImage3D` errors).
 */
export function uploadCube(gl: WebGL2RenderingContext, lut: CubeLut | null): void {
  if (!lut) {
    // One neutral texel: never sampled (`u_hasLut` is false), but bound so the
    // sampler types do not collide on unit 0.
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    return;
  }
  const n = lut.size;
  const texels = n * n * n;
  // The source is RGB; expanded to RGBA (alpha = 1) for predictable alignment.
  const rgba = new Float32Array(texels * 4);
  for (let i = 0; i < texels; i += 1) {
    rgba[i * 4] = lut.data[i * 3];
    rgba[i * 4 + 1] = lut.data[i * 3 + 1];
    rgba[i * 4 + 2] = lut.data[i * 3 + 2];
    rgba[i * 4 + 3] = 1;
  }
  gl.texImage3D(gl.TEXTURE_3D, 0, cubeInternalFormat(gl), n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
}
