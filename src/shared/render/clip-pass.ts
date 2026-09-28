/**
 * The clipping view — `clipOf` in GLSL, painted over the picture on the
 * stage (audit item 15). A way of LOOKING, like the mask's wash: the stage
 * puts it after every pass that shapes the picture, and nothing that leaves
 * (`delivered()`, a snapshot, the histogram, an export) ever asks for it.
 *
 * The test is made on the value the 8-bit canvas WILL hold: a float the
 * encoder rounds to 254 is at or past 253.5 / 255, one it rounds to 1 is
 * under 1.5 / 255 — so the overlay and the strip's percentages count the
 * same pixels.
 *
 * Holds no texture and no uniform, so one pass serves every graph, the way
 * `passthroughPass` does.
 */

import { GLSL_VERSION } from './glsl';
import type { RenderPass } from './graph';
import { CLIP_BLACK, CLIP_MARKS, CLIP_WHITE } from './clipping';

const glslColour = ([r, g, b]: readonly [number, number, number]) =>
  `vec3(${(r / 255).toFixed(6)}, ${(g / 255).toFixed(6)}, ${(b / 255).toFixed(6)})`;

export const clipPass: RenderPass = {
  id: 'clipping',
  fragment: `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 byte = clamp(src.rgb, 0.0, 1.0) * 255.0;
  // White when ANY channel is there, black when EVERY one is — and every
  // channel under the line is the brightest one under it.
  float top = max(byte.r, max(byte.g, byte.b));
  if (top >= ${(CLIP_WHITE - 0.5).toFixed(1)}) outColor = vec4(${glslColour(CLIP_MARKS.white)}, src.a);
  else if (top < ${(CLIP_BLACK + 0.5).toFixed(1)}) outColor = vec4(${glslColour(CLIP_MARKS.black)}, src.a);
  else outColor = src;
}`,
};
