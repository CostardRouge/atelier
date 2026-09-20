/**
 * The repair pass — the whole patch list as ONE fragment pass, the GLSL of
 * `repair.ts`, transcribed: the same coverage, the same ring weight, the same
 * 9×9 means, the same order. `scripts/check-render.mjs` holds it to the pure
 * module at probes over and around a patch.
 *
 * It runs FIRST, on the source, so it works in IMAGE coordinates (`imageUv`):
 * a patch is placed on the picture the author sees, and the source texture may
 * run either way (`glsl.ts`). Every sample of a computed image point goes back
 * through `imageUv`, as the keystone's does.
 *
 * The list is a pair of uniform arrays of `MAX_PATCHES` entries; a fragment
 * walks only up to `u_count` and pays the 9×9 means only for a heal that
 * covers it. A GLSL loop needs a constant bound, so the arrays are fixed and
 * the walk breaks early. The locals are `pt`, never `patch`: that word is
 * RESERVED in GLSL ES 3.00 and the driver refuses the whole pass over it —
 * silently, as black, until the gate relayed the console.
 */

import { GLSL_VERSION, IMAGE_UV } from './glsl';
import type { RenderPass } from './graph';
import { MAX_PATCHES, MEAN_GRID, RING_REACH, type Patch } from './repair';

const FRAGMENT = `${GLSL_VERSION}
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
uniform vec2 u_span;               // the frame in the centred space whose half-diagonal is 1
uniform int u_count;
uniform vec4 u_patch[${MAX_PATCHES}];   // centre.x, centre.y (frame [0,1]), radius, feather
uniform vec4 u_from[${MAX_PATCHES}];    // dx, dy (frame units), kind (0 clone, 1 heal), unused
${IMAGE_UV}

// Mirrors patchCoverageAt in repair.ts.
float coverageAt(vec4 pt, vec2 img) {
  vec2 p = (img - 0.5) * u_span;
  vec2 c = (pt.xy - 0.5) * u_span;
  float d = length(p - c);
  float hard = pt.z * (1.0 - pt.w);
  if (d <= hard) return 1.0;
  if (d >= pt.z) return 0.0;
  return 1.0 - smoothstep(hard, pt.z, d);
}

// Mirrors ringWeightAt.
float ringAt(vec4 pt, vec2 img) {
  vec2 p = (img - 0.5) * u_span;
  vec2 c = (pt.xy - 0.5) * u_span;
  float d = length(p - c);
  if (d >= pt.z * ${RING_REACH.toFixed(2)}) return 0.0;
  return 1.0 - coverageAt(pt, img);
}

vec3 pick(vec2 img) { return texture(u_src, imageUv(img)).rgb; }

void main() {
  vec2 img = imageUv(v_uv);
  vec4 src = texture(u_src, v_uv);
  vec3 outRgb = src.rgb;
  for (int i = 0; i < ${MAX_PATCHES}; i++) {
    if (i >= u_count) break;
    vec4 pt = u_patch[i];
    float cov = coverageAt(pt, img);
    if (cov <= 0.0) continue;
    vec2 offset = u_from[i].xy;
    vec3 healed = pick(img + offset);
    if (u_from[i].z > 0.5) {
      // The means AROUND the destination and the source, over the reach.
      vec2 reach = vec2(pt.z * ${RING_REACH.toFixed(2)}) / u_span;
      vec3 dst = vec3(0.0);
      vec3 from = vec3(0.0);
      float sum = 0.0;
      for (int j = 0; j < ${MEAN_GRID}; j++) {
        for (int k = 0; k < ${MEAN_GRID}; k++) {
          vec2 at = pt.xy + reach * (vec2(float(k), float(j)) / ${(MEAN_GRID - 1).toFixed(1)} * 2.0 - 1.0);
          float w = ringAt(pt, at);
          if (w <= 0.0) continue;
          dst += pick(at) * w;
          from += pick(at + offset) * w;
          sum += w;
        }
      }
      if (sum > 0.0) healed = max(healed + (dst - from) / sum, 0.0);
    }
    outRgb = mix(outRgb, healed, cov);
  }
  outColor = vec4(outRgb, src.a);
}`;

/** The pass for a list of patches over a frame of this shape, or null for an empty list. */
export function makeRepairPass(patches: readonly Patch[] | null | undefined, aspectRatio = 1): RenderPass | null {
  const list = (patches ?? []).slice(0, MAX_PATCHES);
  if (list.length === 0) return null;
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  const patch = new Float32Array(MAX_PATCHES * 4);
  const from = new Float32Array(MAX_PATCHES * 4);
  list.forEach((p, i) => {
    patch.set([p.x, p.y, p.radius, p.feather], i * 4);
    from.set([p.dx, p.dy, p.kind === 'heal' ? 1 : 0, 0], i * 4);
  });
  return {
    id: 'repair',
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      gl.uniform2f(gl.getUniformLocation(program, 'u_span'), (ar / diagonal) * 2, (1 / diagonal) * 2);
      gl.uniform1i(gl.getUniformLocation(program, 'u_count'), list.length);
      gl.uniform4fv(gl.getUniformLocation(program, 'u_patch'), patch);
      gl.uniform4fv(gl.getUniformLocation(program, 'u_from'), from);
    },
  };
}
