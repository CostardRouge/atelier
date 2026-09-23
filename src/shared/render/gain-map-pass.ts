/**
 * The camera's own shading correction as ONE pass, FIRST on the source.
 *
 * It asks WHERE a pixel is, so it converts with `imageUv` (`glsl.ts`,
 * `render-geometry.md`'s rule): a gain grid read straight off `v_uv` would be
 * upside down for a canvas or for a bitmap, whichever way round it was
 * written, and a corner lifted 2.5 stops on the wrong corner is the worst
 * possible outcome — it looks like a correction.
 *
 * The grid is uploaded as an RGBA32F texture and sampled with FOUR
 * `texelFetch`es and a manual bilinear, never with LINEAR filtering: filtering
 * a float texture needs `OES_texture_float_linear`, which not every GPU has
 * (`render-core.md` — the cube already pays for that), and a 32 × 32 grid is
 * four fetches nobody can measure. It also makes the shader the LITERAL twin
 * of `gainAt`, which is what `check-render.mjs` compares.
 *
 * The maths, and why it is in light rather than code, is `gain-map.ts`.
 */

import { GLSL_VERSION, IMAGE_UV, SRGB_TRANSFER } from './glsl';
import { isFlatField, type GainField } from './gain-map';
import type { RenderPass } from './graph';

const FRAGMENT = `${GLSL_VERSION}
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
uniform sampler2D u_gain;     // unit 1: the grid, RGBA32F, NEAREST
uniform vec2 u_gainSize;      // cols, rows
uniform vec2 u_gainOrigin;    // node (0,0), in [0,1] of the IMAGE
uniform vec2 u_gainStep;      // the distance between nodes, same units
${IMAGE_UV}
${SRGB_TRANSFER}

// Mirrors gainAt() in gain-map.ts — bilinear between the nodes, held at the
// edge outside them. The two MUST agree; check-render.mjs proves it.
vec3 gainAt(vec2 img) {
  vec2 g = (img - u_gainOrigin) / u_gainStep;
  g = clamp(g, vec2(0.0), u_gainSize - 1.0);
  vec2 i0 = floor(g);
  vec2 f = g - i0;
  ivec2 a = ivec2(i0);
  ivec2 b = ivec2(min(i0 + 1.0, u_gainSize - 1.0));
  vec3 g00 = texelFetch(u_gain, ivec2(a.x, a.y), 0).rgb;
  vec3 g01 = texelFetch(u_gain, ivec2(b.x, a.y), 0).rgb;
  vec3 g10 = texelFetch(u_gain, ivec2(a.x, b.y), 0).rgb;
  vec3 g11 = texelFetch(u_gain, ivec2(b.x, b.y), 0).rgb;
  return mix(mix(g00, g01, f.x), mix(g10, g11, f.x), f.y);
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 gain = gainAt(imageUv(v_uv));
  // In LIGHT, never on the code: the lens lost light at the corner, and a
  // gain on an encoded value is a tone-dependent correction (gain-map.ts).
  outColor = vec4(linearToSrgb(srgbToLinear(src.rgb) * gain), src.a);
}`;

/**
 * A gain-map pass, or null when the field would multiply nothing — a caller
 * then runs one fewer pass rather than a no-op round trip through the
 * transfer function.
 */
export function makeGainMapPass(field: GainField | null | undefined): RenderPass | null {
  if (!field || isFlatField(field)) return null;
  let texture: WebGLTexture | null = null;
  return {
    id: 'gain-map',
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      if (!texture) {
        texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // The graph leaves UNPACK_FLIP_Y_WEBGL ON for its source uploads, and
        // a TYPED ARRAY honours that flag (only a bitmap ignores it — the rule
        // `raw.md` records for the half-float source). Left on, the grid lands
        // upside down and the corner the file lifts 2.5 stops is the opposite
        // one: measured by `check-render.mjs` the moment this pass was written,
        // as 100 codes against the pure twin.
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          field.cols,
          field.rows,
          0,
          gl.RGBA,
          gl.FLOAT,
          field.gains,
        );
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const at = (name: string) => gl.getUniformLocation(program, name);
      gl.uniform1i(at('u_gain'), 1);
      gl.uniform2f(at('u_gainSize'), field.cols, field.rows);
      gl.uniform2f(at('u_gainOrigin'), field.originU, field.originV);
      gl.uniform2f(at('u_gainStep'), field.stepU, field.stepV);
      // Unit 0 is the graph's own source, and leaving unit 1 selected would
      // hand the next pass a bound grid where it expects nothing.
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose(gl) {
      if (texture) gl.deleteTexture(texture);
      texture = null;
    },
  };
}
