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

      // A `sampler3D` is bound EVEN WITH NO LOOK, to a 1-texel placeholder.
      // Left unset it defaults to unit 0, where the `sampler2D` source already
      // is — and two sampler types on one unit is INVALID_OPERATION at draw
      // time, so the whole pass is dropped and the canvas stays black. Measured:
      // the core's first run drew nothing, with GL error 1282 and no exception.
      if (!uploaded || uploaded.lut !== lut || uploaded.gl !== gl) {
        if (uploaded && uploaded.gl === gl) gl.deleteTexture(uploaded.tex);
        const tex = gl.createTexture();
        if (!tex) return;
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
 * The cube's texels, in the only format this GPU can FILTER.
 *
 * Without `OES_texture_float_linear` an `RGBA32F` texture set to LINEAR is
 * INCOMPLETE, and sampling an incomplete texture returns black — no error, no
 * exception, just a black picture. `lut-gl.ts` has always branched here;
 * copying its GLSL without copying this was what made the core's first run
 * black on SwiftShader, where the extension is absent.
 */
function uploadCube(gl: WebGL2RenderingContext, lut: CubeLut | null): void {
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
  if (gl.getExtension('OES_texture_float_linear')) {
    const rgba = new Float32Array(texels * 4);
    for (let i = 0; i < texels; i += 1) {
      rgba[i * 4] = lut.data[i * 3];
      rgba[i * 4 + 1] = lut.data[i * 3 + 1];
      rgba[i * 4 + 2] = lut.data[i * 3 + 2];
      rgba[i * 4 + 3] = 1;
    }
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
    return;
  }
  const rgba = new Uint8Array(texels * 4);
  for (let i = 0; i < texels; i += 1) {
    rgba[i * 4] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3])) * 255);
    rgba[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 1])) * 255);
    rgba[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 2])) * 255);
    rgba[i * 4 + 3] = 255;
  }
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
}
