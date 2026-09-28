/**
 * The post-crop vignette — the GLSL of `post-vignette.ts`, a TRANSCRIPTION.
 *
 * It asks WHERE a pixel is, so it converts with `imageUv` (`glsl.ts`,
 * `render-geometry.md`'s rule): the affine it is handed maps IMAGE
 * coordinates, y down from the picture's top, to the delivered frame's.
 */

import { GLSL_VERSION, IMAGE_UV, SRGB_TRANSFER } from './glsl';
import type { RenderPass } from './graph';
import { postVignetteTerms, type FrameAffine, type PostCropVignette } from './post-vignette';

const FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec3 u_rowU;       // u = dot(u_rowU, vec3(x, y, 1))
uniform vec3 u_rowV;
uniform float u_aspect;    // the delivered frame's width / height
uniform float u_amount;
uniform float u_start;
uniform float u_width;
uniform float u_round;
uniform float u_highlights;
${IMAGE_UV}
${SRGB_TRANSFER}
vec3 decode(vec3 c) { return srgbToLinear(clamp(c, 0.0, 1.0)); }
vec3 encode(vec3 c) { return linearToSrgb(clamp(c, 0.0, 1.0)); }
float shapeDistance(vec2 f) {
  vec2 p = (f - 0.5) * 2.0;
  if (u_round > 0.0) {
    vec2 q = u_aspect >= 1.0 ? vec2(p.x, p.y / u_aspect) : vec2(p.x * u_aspect, p.y);
    p += (q - p) * u_round;
  }
  float n = u_round < 0.0 ? 2.0 + 8.0 * -u_round : 2.0;
  return pow(pow(abs(p.x), n) + pow(abs(p.y), n), 1.0 / n);
}
void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 img = vec3(imageUv(v_uv), 1.0);
  vec2 f = vec2(dot(u_rowU, img), dot(u_rowV, img));
  float t = smoothstep(u_start, u_start + u_width, shapeDistance(f));
  if (t <= 0.0 || u_amount == 0.0) { outColor = src; return; }
  vec3 lin = decode(src.rgb);
  vec3 outLin;
  if (u_amount < 0.0) {
    float y = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
    float spare = 1.0 - u_highlights * smoothstep(0.5, 1.0, y);
    outLin = lin * (1.0 + u_amount * t * spare);
  } else {
    outLin = lin + (1.0 - lin) * u_amount * t;
  }
  outColor = vec4(encode(outLin), src.a);
}`;

const at = (gl: WebGL2RenderingContext, program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);

/** The pass for one picture's vignette, framed by `affine`; null when there is nothing to draw. */
export function makePostVignettePass(
  vignette: PostCropVignette | null | undefined,
  affine: FrameAffine,
  frameAspect: number,
): RenderPass | null {
  if (!vignette || vignette.amount === 0) return null;
  const t = postVignetteTerms(vignette);
  return {
    id: 'post-vignette',
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      gl.uniform3f(at(gl, program, 'u_rowU'), affine[0], affine[1], affine[2]);
      gl.uniform3f(at(gl, program, 'u_rowV'), affine[3], affine[4], affine[5]);
      gl.uniform1f(at(gl, program, 'u_aspect'), frameAspect);
      gl.uniform1f(at(gl, program, 'u_amount'), t.amount);
      gl.uniform1f(at(gl, program, 'u_start'), t.start);
      gl.uniform1f(at(gl, program, 'u_width'), t.width);
      gl.uniform1f(at(gl, program, 'u_round'), t.roundness);
      gl.uniform1f(at(gl, program, 'u_highlights'), t.highlights);
    },
  };
}
