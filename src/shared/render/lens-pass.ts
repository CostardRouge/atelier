/**
 * The lens correction as ONE pass.
 *
 * Distortion, lateral CA and vignetting are all functions of the radius alone,
 * so a single pass does the lot: it computes the radius once, samples each
 * channel at its own scale of it, and multiplies by the gain at that radius.
 * Three passes would resample three times, and every resample after the first
 * is blur paid for nothing.
 *
 * The maths is `lens.ts`, where a spec can hold it — including the one property
 * that keeps this control from breaking a picture rather than merely overdoing
 * it: the radius map is monotone across the frame, so the corners cannot fold.
 *
 * **No y mirror here**, unlike the keystone: every term is a function of the
 * DISTANCE from the centre, which a flip leaves alone. That is not an oversight
 * to be corrected later — `check-render.mjs` measures the radius the GPU really
 * lands a marker at, so a mirror creeping in would show up as a failure.
 */

import { GLSL_VERSION } from './glsl';
import {
  chromaScales,
  distortionTerms,
  isDefaultLens,
  vignetteTerms,
  type LensCorrection,
} from './lens';
import type { RenderPass } from './graph';

const FRAGMENT = `${GLSL_VERSION}
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
uniform vec2 u_span;       // the frame, in a space whose half-DIAGONAL is 1
uniform float u_k1;
uniform float u_k2;
uniform vec2 u_chroma;     // red and blue scales; green is the reference at 1.0
uniform float u_vigAmount;
uniform float u_vigStart;

// Where a corrected point at radius r came from. Mirrors lensSampleRadius in
// lens.ts -- the two MUST agree, and check-render.mjs is what proves it.
float sampleRadius(float r) {
  float r2 = r * r;
  return r * (1.0 + u_k1 * r2 + u_k2 * r2 * r2);
}

// Where to read one channel, at its own scale of the source radius.
vec2 sampleUv(vec2 dir, float rSource, float scale) {
  return dir * (rSource * scale) / u_span + 0.5;
}

bool outside(vec2 uv) {
  return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

void main() {
  // Centred, and scaled so the frame's own corner sits at radius 1 -- half the
  // DIAGONAL, which is what makes a number mean the same at any aspect.
  vec2 d = (v_uv - 0.5) * u_span;
  float r = length(d);
  vec2 dir = r > 0.0 ? d / r : vec2(0.0);
  float rs = sampleRadius(r);

  vec2 uvG = sampleUv(dir, rs, 1.0);
  // Outside the picture is EMPTY, never the edge pixel smeared outwards -- the
  // same refusal the keystone makes, for the same reason.
  if (outside(uvG)) { outColor = vec4(0.0); return; }
  vec4 green = texture(u_src, uvG);

  vec3 rgb = green.rgb;
  if (u_chroma.x != 1.0 || u_chroma.y != 1.0) {
    vec2 uvR = sampleUv(dir, rs, u_chroma.x);
    vec2 uvB = sampleUv(dir, rs, u_chroma.y);
    // A channel whose own scale took it off the picture keeps green's, rather
    // than going black and painting a coloured edge of its own.
    rgb.r = outside(uvR) ? green.r : texture(u_src, uvR).r;
    rgb.b = outside(uvB) ? green.b : texture(u_src, uvB).b;
  }

  if (u_vigAmount != 0.0 && r > u_vigStart) {
    float t = (r - u_vigStart) / max(1e-6, 1.0 - u_vigStart);
    // Squared, so there is no visible ring where the lift begins.
    rgb *= 1.0 + u_vigAmount * t * t;
  }

  outColor = vec4(rgb, green.a);
}`;

/**
 * A lens pass, or null when the correction does nothing — a caller then runs
 * one fewer pass rather than a no-op resample, which would cost a whole round
 * trip of interpolation for no change at all.
 */
export function makeLensPass(
  lens: LensCorrection | null | undefined,
  aspectRatio = 1,
): RenderPass | null {
  if (!lens || isDefaultLens(lens)) return null;
  const { k1, k2 } = distortionTerms(lens);
  const { red, blue } = chromaScales(lens);
  const { amount, start } = vignetteTerms(lens);
  // The frame in a space whose half-DIAGONAL is 1: the corner is then at radius
  // 1 whatever the shape, so the same numbers mean the same thing on a 3:2 frame
  // and on a 4:5 crop of it. Lensfun's own convention, and the one `lens.ts`
  // normalises to.
  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);

  return {
    id: 'lens',
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      const at = (name: string) => gl.getUniformLocation(program, name);
      gl.uniform2f(at('u_span'), (ar / diagonal) * 2, (1 / diagonal) * 2);
      gl.uniform1f(at('u_k1'), k1);
      gl.uniform1f(at('u_k2'), k2);
      gl.uniform2f(at('u_chroma'), red, blue);
      gl.uniform1f(at('u_vigAmount'), amount);
      gl.uniform1f(at('u_vigStart'), start);
    },
  };
}
