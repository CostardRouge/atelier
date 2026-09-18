/**
 * The keystone, as a pass — the first thing in the suite that MOVES a pixel.
 *
 * A warp is drawn by walking the OUTPUT and asking where each pixel came from,
 * so what the shader carries is the inverse of the correction
 * (`keystoneSampleMatrix`). Everything about the matrix is decided in
 * `geometry.ts`, where a spec can hold it; this only applies it.
 *
 * **Where the picture ran out, it is EMPTY.** A warp genuinely has no data
 * beyond the source's edge, and clamping to the edge pixel would smear a band
 * of invented picture along it — the same fabrication the battery gauge
 * refuses. The zoom is what hides the corners, and the panel says so.
 *
 * **It works in IMAGE coordinates, not texture ones** (`imageUv`, `glsl.ts`).
 * That is not tidiness: `v_uv`'s y runs with the picture for a canvas source
 * and against it for an `ImageBitmap`, so a matrix applied to `v_uv` directly
 * is upside down for one of them. It was — every decoded photograph took its
 * perspective correction mirrored until this was measured.
 */

import { GLSL_VERSION, IMAGE_UV } from './glsl';
import {
  keystoneSampleMatrix,
  toColumnMajor,
  type Keystone,
  type Matrix3,
} from './geometry';
import type { RenderPass } from './graph';

const FRAGMENT = `${GLSL_VERSION}
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
// DESTINATION to SOURCE, in centred [-0.5,0.5] IMAGE coordinates -- y down from
// the top of the picture, whichever way the texture happens to be stored.
// NO BACKTICKS IN HERE: one ends the template literal, and the file then fails
// to parse (media-pipeline.md has worn this before).
uniform mat3 u_sample;
${IMAGE_UV}

void main() {
  vec2 img = imageUv(v_uv);
  vec3 s = u_sample * vec3(img - 0.5, 1.0);
  // Bent through the horizon: no source point exists, so nothing is drawn.
  if (abs(s.z) < 1e-6) { outColor = vec4(0.0); return; }
  vec2 at = s.xy / s.z + 0.5;
  // Outside the picture is EMPTY, never the edge pixel smeared outwards.
  if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) { outColor = vec4(0.0); return; }
  outColor = texture(u_src, imageUv(at));
}`;

/**
 * The warp for a keystone — the call every consumer should make.
 *
 * The matrix goes in as `geometry.ts` states it, in image space; the shader
 * converts. `scripts/check-render.mjs` drives a marker through it from BOTH a
 * canvas and an `ImageBitmap`, so nobody has to work the convention out again.
 */
export function makeKeystonePass(keystone: Keystone, aspectRatio = 1): RenderPass | null {
  const sample = keystoneSampleMatrix(keystone, aspectRatio);
  // Numbers that fold the plane: the caller draws unwarped rather than blank.
  if (!sample) return null;
  return keystonePassFromMatrix(sample);
}

/** The raw form, for a checker that wants to state the matrix itself. */
export function keystonePassFromMatrix(sample: Matrix3): RenderPass {
  const columns = toColumnMajor(sample);
  return {
    id: 'keystone',
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      const loc = gl.getUniformLocation(program, 'u_sample');
      // `false`: the array is already column-major. WebGL2 would accept a
      // transpose flag, but WebGL1 never did and a silent row/column swap is a
      // picture warped the wrong way with nothing to show for it.
      if (loc) gl.uniformMatrix3fv(loc, false, columns);
    },
  };
}
