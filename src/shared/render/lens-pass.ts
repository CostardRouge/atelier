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

import { GLSL_VERSION, SRGB_TRANSFER } from './glsl';
import {
  DEFAULT_LENS,
  NO_PROFILE_TERMS,
  chromaScales,
  distortionTerms,
  isDefaultLens,
  isIdentityProfile,
  vignetteTerms,
  type LensCorrection,
  type LensProfileTerms,
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
// A MEASURED profile (lens.ts, LensProfileTerms), after the sliders.
uniform vec4 u_pd;         // distortion d1..d4
uniform vec3 u_ptr;        // red TCA  v, c, b
uniform vec3 u_ptb;        // blue TCA v, c, b
uniform vec3 u_pv;         // vignetting k1..k3, at the source radius
${SRGB_TRANSFER}

// Where a corrected point at radius r came from. Mirrors lensSampleRadius in
// lens.ts -- the two MUST agree, and check-render.mjs is what proves it.
float sampleRadius(float r) {
  float r2 = r * r;
  return r * (1.0 + u_k1 * r2 + u_k2 * r2 * r2);
}

// Mirrors profileSourceRadius, Horner's form in both.
float profileRadius(float m) {
  return m * (1.0 + m * (u_pd.x + m * (u_pd.y + m * (u_pd.z + m * u_pd.w))));
}

// Mirrors profileChannelRadius: a channel's radius against green's.
float channelScale(vec3 t, float rs) {
  return t.x + rs * (t.y + rs * t.z);
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
  float rs = profileRadius(sampleRadius(r));

  vec2 uvG = sampleUv(dir, rs, 1.0);
  // Outside the picture is EMPTY, never the edge pixel smeared outwards -- the
  // same refusal the keystone makes, for the same reason.
  if (outside(uvG)) { outColor = vec4(0.0); return; }
  vec4 green = texture(u_src, uvG);

  vec3 rgb = green.rgb;
  float scaleR = u_chroma.x * channelScale(u_ptr, rs);
  float scaleB = u_chroma.y * channelScale(u_ptb, rs);
  if (scaleR != 1.0 || scaleB != 1.0) {
    vec2 uvR = sampleUv(dir, rs, scaleR);
    vec2 uvB = sampleUv(dir, rs, scaleB);
    // A channel whose own scale took it off the picture keeps green's, rather
    // than going black and painting a coloured edge of its own.
    rgb.r = outside(uvR) ? green.r : texture(u_src, uvR).r;
    rgb.b = outside(uvB) ? green.b : texture(u_src, uvB).b;
  }

  float gain = 1.0;
  if (u_vigAmount != 0.0 && r > u_vigStart) {
    float t = (r - u_vigStart) / max(1e-6, 1.0 - u_vigStart);
    // Squared, so there is no visible ring where the lift begins.
    gain = 1.0 + u_vigAmount * t * t;
  }
  // The measured vignetting, at the SOURCE radius (profileVignetteGain).
  float rs2 = rs * rs;
  gain /= 1.0 + rs2 * (u_pv.x + rs2 * (u_pv.y + rs2 * u_pv.z));
  if (gain != 1.0) {
    // A gain on LIGHT, so it is applied to the decoded value: the lens lost
    // light at the corner, not code, and multiplying the encoded value would
    // lift a dark corner three times as much as a bright one
    // (vignetteEncoded, lens.ts).
    rgb = linearToSrgb(srgbToLinear(rgb) * gain);
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
  /** A measured profile, composed under the sliders — `lens.ts`, `LensProfileTerms`. */
  profile: LensProfileTerms | null = null,
): RenderPass | null {
  const noProfile = isIdentityProfile(profile);
  if ((!lens || isDefaultLens(lens)) && noProfile) return null;
  const manual = lens ?? DEFAULT_LENS;
  const { k1, k2 } = distortionTerms(manual);
  const { red, blue } = chromaScales(manual);
  const { amount, start } = vignetteTerms(manual);
  const p = profile && !noProfile ? profile : NO_PROFILE_TERMS;
  // The frame in a space whose half-DIAGONAL is 1: the corner is then at radius
  // 1 whatever the shape, so the same numbers mean the same thing on a 3:2 frame
  // and on a 4:5 crop of it — the unit `lens.ts` normalises to, and the one
  // `lensfun.ts` converts a profile into.
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
      gl.uniform4f(at('u_pd'), p.distortion[0], p.distortion[1], p.distortion[2], p.distortion[3]);
      gl.uniform3f(at('u_ptr'), p.tcaRed[0], p.tcaRed[1], p.tcaRed[2]);
      gl.uniform3f(at('u_ptb'), p.tcaBlue[0], p.tcaBlue[1], p.tcaBlue[2]);
      gl.uniform3f(at('u_pv'), p.vignette[0], p.vignette[1], p.vignette[2]);
    },
  };
}
