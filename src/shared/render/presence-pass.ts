/**
 * The presence passes — the GLSL of `presence.ts`, a TRANSCRIPTION (the
 * `detail-pass.ts` rule), two passes per slider:
 *
 * 1. **blur** — the signal (luma, or the dark channel) blurred along X, the
 *    picture carried through untouched and the result written into ALPHA:
 *    a pass sees only its input, and the second half needs the picture AND
 *    the estimate. Every picture here is opaque, so alpha is free.
 * 2. **apply** — that alpha blurred along Y, then the pixel moved against
 *    it; alpha is written back to 1.
 *
 * The sigma is a share of the picture's SHORT SIDE, measured from `u_texel`
 * the graph sets, so no caller has to tell a pass how big the render is.
 * The taps are spaced past one pixel and read with the graph's LINEAR
 * filtering — which is what `sampleBilinear` mirrors.
 */

import { GLSL_VERSION, SRGB_TRANSFER } from './glsl';
import type { RenderPass } from './graph';
import {
  CONTRAST_GAIN,
  DEHAZE_FLOOR,
  DEHAZE_STRENGTH,
  HAZE_ADDED,
  PRESENCE_SCALE,
  PRESENCE_TAPS,
  SOFT_LIMIT,
  type PresenceAmounts,
  type PresenceOp,
} from './presence';

const GEOMETRY = `
uniform vec2 u_texel;
uniform float u_frac;
float gaussianW(float x, float sigma) { return exp(-(x * x) / (2.0 * sigma * sigma)); }
void geometry(out float sigma, out float spacing, out int taps) {
  vec2 size = 1.0 / u_texel;
  sigma = max(0.8, u_frac * min(size.x, size.y));
  spacing = max(1.0, 3.0 * sigma / ${PRESENCE_TAPS}.0);
  taps = int(min(${PRESENCE_TAPS}.0, ceil(3.0 * sigma / spacing)));
}
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
${SRGB_TRANSFER}
// The twin's transfer clamps to [0,1] (lut/transfer.ts), so this one does too.
vec3 decode(vec3 c) { return srgbToLinear(clamp(c, 0.0, 1.0)); }
vec3 encode(vec3 c) { return linearToSrgb(clamp(c, 0.0, 1.0)); }
`;

const BLUR_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform int u_dark;
${GEOMETRY}
void main() {
  vec4 src = texture(u_src, v_uv);
  float sigma; float spacing; int taps;
  geometry(sigma, spacing, taps);
  float acc = 0.0;
  float sum = 0.0;
  for (int k = -${PRESENCE_TAPS}; k <= ${PRESENCE_TAPS}; k++) {
    if (k < -taps || k > taps) continue;
    float d = float(k) * spacing;
    float w = gaussianW(d, sigma);
    vec3 n = texture(u_src, v_uv + vec2(u_texel.x * d, 0.0)).rgb;
    vec3 l = decode(n);
    acc += w * (u_dark == 1 ? min(l.r, min(l.g, l.b)) : lumaOf(n));
    sum += w;
  }
  outColor = vec4(src.rgb, acc / sum);
}`;

const APPLY_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform int u_op;        // 0 dehaze, 1 clarity, 2 texture
uniform float u_amount;  // -1..1
${GEOMETRY}
vec3 scaleToLuma(vec3 c, float y, float target) {
  if (y <= 1e-6) return vec3(target);
  return max(c * (target / y), 0.0);
}
void main() {
  vec3 src = texture(u_src, v_uv).rgb;
  float sigma; float spacing; int taps;
  geometry(sigma, spacing, taps);
  float acc = 0.0;
  float sum = 0.0;
  for (int k = -${PRESENCE_TAPS}; k <= ${PRESENCE_TAPS}; k++) {
    if (k < -taps || k > taps) continue;
    float d = float(k) * spacing;
    float w = gaussianW(d, sigma);
    acc += w * texture(u_src, v_uv + vec2(0.0, u_texel.y * d)).a;
    sum += w;
  }
  float blurred = acc / sum;
  vec3 outRgb;
  if (u_op == 0) {
    vec3 lin = decode(src);
    if (u_amount > 0.0) {
      float t = max(${DEHAZE_FLOOR.toFixed(4)}, 1.0 - ${DEHAZE_STRENGTH.toFixed(4)} * u_amount * blurred);
      outRgb = encode(max((lin - 1.0) / t + 1.0, 0.0));
    } else {
      float t = 1.0 + ${HAZE_ADDED.toFixed(4)} * u_amount;
      outRgb = encode(lin * t + (1.0 - t));
    }
  } else {
    float y = lumaOf(src);
    float gain = u_amount * (u_amount > 0.0 ? ${CONTRAST_GAIN.up.toFixed(4)} : ${CONTRAST_GAIN.down.toFixed(4)});
    float bell = u_op == 1 ? clamp(4.0 * y * (1.0 - y), 0.0, 1.0) : 1.0;
    float d = y - blurred;
    float soft = d / (1.0 + ${SOFT_LIMIT.toFixed(1)} * abs(d));
    outRgb = scaleToLuma(src, y, max(0.0, y + gain * soft * bell));
  }
  outColor = vec4(outRgb, 1.0);
}`;

const at = (gl: WebGL2RenderingContext, program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
const OPS: readonly PresenceOp[] = ['dehaze', 'clarity', 'texture'];

/** The pair of passes for one slider. */
export function makePresencePasses(op: PresenceOp, amount: number): RenderPass[] {
  const frac = PRESENCE_SCALE[op];
  return [
    {
      id: 'presence-blur',
      fragment: BLUR_FRAGMENT,
      setUniforms(gl, program) {
        gl.uniform1f(at(gl, program, 'u_frac'), frac);
        gl.uniform1i(at(gl, program, 'u_dark'), op === 'dehaze' ? 1 : 0);
      },
    },
    {
      id: 'presence-apply',
      fragment: APPLY_FRAGMENT,
      setUniforms(gl, program) {
        gl.uniform1f(at(gl, program, 'u_frac'), frac);
        gl.uniform1i(at(gl, program, 'u_op'), OPS.indexOf(op));
        gl.uniform1f(at(gl, program, 'u_amount'), amount);
      },
    },
  ];
}

/** Every pass the amounts ask for, in order — dehaze, clarity, texture; empty when all are 0. */
export function presencePasses(amounts: PresenceAmounts): RenderPass[] {
  return OPS.flatMap((op) => (amounts[op] ? makePresencePasses(op, amounts[op]) : []));
}
