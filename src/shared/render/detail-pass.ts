/**
 * The detail passes — the GLSL of `detail.ts`, one fragment pass each.
 *
 * Every shader here is a TRANSCRIPTION of the pure function beside it, taps
 * and weights included, so `scripts/check-render.mjs` can hold the GPU to
 * the arithmetic at probe points; a re-derivation would be a second
 * implementation nothing could check (the `layer-pass.ts` rule).
 *
 * All of them read `u_texel` (the graph sets it) and sample with
 * CLAMP_TO_EDGE, which is what `pixelAt` clamps like. Loops are bounded by
 * the constants in `detail.ts` and skip past the radius asked for: GLSL ES
 * needs a constant bound, and a uniform inside the condition is what makes
 * one kernel serve every slider value.
 *
 * Two families by where they run (`detail.ts`, «Order»): the noise and
 * fringe passes BEFORE the cube, on the source; the sharpen AFTER every
 * warp. `detailPasses` hands both lists back and the grader places them.
 */

import { GLSL_VERSION } from './glsl';
import type { RenderPass } from './graph';
import {
  BILATERAL_RADIUS,
  CHROMA_MAX_RADIUS,
  DEFAULT_DETAIL,
  DEFRINGE_EDGE,
  DEFRINGE_PURPLE,
  SHARPEN_MAX_RADIUS,
  detailTerms,
  isDefaultDetail,
  type DetailSettings,
  type DetailTerms,
} from './detail';
import { presencePasses } from './presence-pass';

/** The BT.709 split and its inverse, exactly `toYcc` / `fromYcc`. */
const YCC = `
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toYcc(vec3 c) { float y = lumaOf(c); return vec3(y, (c.b - y) / 1.8556, (c.r - y) / 1.5748); }
vec3 fromYcc(vec3 ycc) {
  float r = ycc.x + 1.5748 * ycc.z;
  float b = ycc.x + 1.8556 * ycc.y;
  float g = (ycc.x - 0.2126 * r - 0.0722 * b) / 0.7152;
  return vec3(r, g, b);
}
float gaussianW(float x, float sigma) { return exp(-(x * x) / (2.0 * sigma * sigma)); }
vec3 scaleToLuma(vec3 c, float y, float target) {
  if (y <= 1e-6) return vec3(target);
  return max(c * (target / y), 0.0);
}
`;

const CHROMA_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform vec2 u_axis;      // (1,0) for the H pass, (0,1) for the V pass
uniform float u_sigma;
uniform int u_radius;
${YCC}
void main() {
  vec4 src = texture(u_src, v_uv);
  float y = lumaOf(src.rgb);
  vec2 acc = vec2(0.0);
  float sum = 0.0;
  for (int k = -${CHROMA_MAX_RADIUS}; k <= ${CHROMA_MAX_RADIUS}; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float w = gaussianW(float(k), u_sigma);
    vec3 n = texture(u_src, v_uv + u_axis * u_texel * float(k)).rgb;
    acc += toYcc(n).yz * w;
    sum += w;
  }
  outColor = vec4(fromYcc(vec3(y, acc / sum)), src.a);
}`;

const BILATERAL_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_rangeSigma;
uniform float u_spatialSigma;
${YCC}
void main() {
  vec4 src = texture(u_src, v_uv);
  float y = lumaOf(src.rgb);
  float acc = 0.0;
  float sum = 0.0;
  for (int dy = -${BILATERAL_RADIUS}; dy <= ${BILATERAL_RADIUS}; dy++) {
    for (int dx = -${BILATERAL_RADIUS}; dx <= ${BILATERAL_RADIUS}; dx++) {
      float ny = lumaOf(texture(u_src, v_uv + u_texel * vec2(float(dx), float(dy))).rgb);
      float w = gaussianW(length(vec2(float(dx), float(dy))), u_spatialSigma) * gaussianW(ny - y, u_rangeSigma);
      acc += ny * w;
      sum += w;
    }
  }
  outColor = vec4(scaleToLuma(src.rgb, y, acc / sum), src.a);
}`;

const DEFRINGE_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_amount;
${YCC}
void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 ycc = toYcc(src.rgb);
  float edge = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      float ny = lumaOf(texture(u_src, v_uv + u_texel * vec2(float(dx), float(dy))).rgb);
      edge = max(edge, abs(ny - ycc.x));
    }
  }
  float purple = smoothstep(${DEFRINGE_PURPLE.from.toFixed(4)}, ${DEFRINGE_PURPLE.to.toFixed(4)}, min(ycc.y, ycc.z));
  float steep = smoothstep(${DEFRINGE_EDGE.from.toFixed(4)}, ${DEFRINGE_EDGE.to.toFixed(4)}, edge);
  float keep = 1.0 - u_amount * purple * steep;
  outColor = vec4(fromYcc(vec3(ycc.x, ycc.yz * keep)), src.a);
}`;

const SHARPEN_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_gain;
uniform float u_sigma;
uniform int u_radius;
${YCC}
void main() {
  vec4 src = texture(u_src, v_uv);
  float y = lumaOf(src.rgb);
  float acc = 0.0;
  float sum = 0.0;
  for (int dy = -${SHARPEN_MAX_RADIUS}; dy <= ${SHARPEN_MAX_RADIUS}; dy++) {
    if (dy < -u_radius || dy > u_radius) continue;
    for (int dx = -${SHARPEN_MAX_RADIUS}; dx <= ${SHARPEN_MAX_RADIUS}; dx++) {
      if (dx < -u_radius || dx > u_radius) continue;
      float w = gaussianW(length(vec2(float(dx), float(dy))), u_sigma);
      acc += lumaOf(texture(u_src, v_uv + u_texel * vec2(float(dx), float(dy))).rgb) * w;
      sum += w;
    }
  }
  float out_y = max(0.0, y + u_gain * (y - acc / sum));
  outColor = vec4(scaleToLuma(src.rgb, y, out_y), src.a);
}`;

const at = (gl: WebGL2RenderingContext, program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);

/** The chroma blur along one axis; `id` keeps the two programs apart in the graph's cache. */
export function makeChromaBlurPass(terms: DetailTerms, axis: 'x' | 'y'): RenderPass {
  return {
    id: `chroma-${axis}`,
    fragment: CHROMA_FRAGMENT,
    setUniforms(gl, program) {
      gl.uniform2f(at(gl, program, 'u_axis'), axis === 'x' ? 1 : 0, axis === 'x' ? 0 : 1);
      gl.uniform1f(at(gl, program, 'u_sigma'), terms.chromaSigma);
      gl.uniform1i(at(gl, program, 'u_radius'), terms.chromaRadius);
    },
  };
}

export function makeBilateralPass(terms: DetailTerms): RenderPass {
  return {
    id: 'denoise',
    fragment: BILATERAL_FRAGMENT,
    setUniforms(gl, program) {
      gl.uniform1f(at(gl, program, 'u_rangeSigma'), terms.rangeSigma);
      gl.uniform1f(at(gl, program, 'u_spatialSigma'), terms.spatialSigma);
    },
  };
}

export function makeDefringePass(terms: DetailTerms): RenderPass {
  return {
    id: 'defringe',
    fragment: DEFRINGE_FRAGMENT,
    setUniforms(gl, program) {
      gl.uniform1f(at(gl, program, 'u_amount'), terms.defringe);
    },
  };
}

export function makeSharpenPass(terms: DetailTerms): RenderPass {
  return {
    id: 'sharpen',
    fragment: SHARPEN_FRAGMENT,
    setUniforms(gl, program) {
      gl.uniform1f(at(gl, program, 'u_gain'), terms.sharpenGain);
      gl.uniform1f(at(gl, program, 'u_sigma'), terms.sharpenSigma);
      gl.uniform1i(at(gl, program, 'u_radius'), terms.sharpenRadius);
    },
  };
}

export interface DetailPasses {
  /** Before the cube, on the source: colour noise (two passes), luminance noise, defringe. */
  pre: RenderPass[];
  /** After every warp and layer: dehaze, clarity, texture (`presence-pass.ts`), then sharpen. */
  post: RenderPass[];
}

/** Both lists for a picture's settings at the stage's pixel scale; both empty when nothing is set. */
export function detailPasses(detail: DetailSettings | null | undefined, pixelScale = 1): DetailPasses {
  if (isDefaultDetail(detail)) return { pre: [], post: [] };
  const terms = detailTerms(detail, pixelScale);
  const pre: RenderPass[] = [];
  if (terms.chromaSigma > 0) pre.push(makeChromaBlurPass(terms, 'x'), makeChromaBlurPass(terms, 'y'));
  if (terms.rangeSigma > 0) pre.push(makeBilateralPass(terms));
  if (terms.defringe > 0) pre.push(makeDefringePass(terms));
  const s = { ...DEFAULT_DETAIL, ...(detail ?? {}) };
  const post: RenderPass[] = presencePasses({ dehaze: s.dehaze / 100, clarity: s.clarity / 100, texture: s.texture / 100 });
  if (terms.sharpenGain > 0) post.push(makeSharpenPass(terms));
  return { pre, post };
}
