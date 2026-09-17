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
 */

import { GLSL_VERSION } from './glsl';
import {
  keystoneSampleMatrix,
  mirrorYMatrix,
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
// DESTINATION to SOURCE, in centred [-0.5,0.5] coordinates of THIS pass's uv
// space. The caller mirrors y where its space does -- see mirrorYMatrix in
// geometry.ts. NO BACKTICKS IN HERE: one ends the template literal, and the
// file then fails to parse (media-pipeline.md has worn this before).
uniform mat3 u_sample;

void main() {
  vec3 s = u_sample * vec3(v_uv - 0.5, 1.0);
  // Bent through the horizon: no source point exists, so nothing is drawn.
  if (abs(s.z) < 1e-6) { outColor = vec4(0.0); return; }
  vec2 uv = s.xy / s.z + 0.5;
  // Outside the picture is EMPTY, never the edge pixel smeared outwards.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { outColor = vec4(0.0); return; }
  outColor = texture(u_src, uv);
}`;

/**
 * The warp for a keystone — the call every consumer should make.
 *
 * It inverts AND mirrors y itself, because the pass's uv space runs y the
 * opposite way from the screen space `geometry.ts` works in. **Measured, not
 * reasoned**: a marker in a known corner, turned 90 degrees, lands where
 * `keystoneMatrix` predicts only with the mirror — without it, at the negation.
 * `scripts/check-render.mjs` holds that, so nobody has to work it out again.
 */
export function makeKeystonePass(keystone: Keystone, aspectRatio = 1): RenderPass | null {
  const sample = keystoneSampleMatrix(keystone, aspectRatio);
  // Numbers that fold the plane: the caller draws unwarped rather than blank.
  if (!sample) return null;
  return keystonePassFromMatrix(mirrorYMatrix(sample));
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
