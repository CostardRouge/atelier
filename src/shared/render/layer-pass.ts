/**
 * ONE adjustment layer, as a pass: mask × develop, mixed over what is beneath.
 *
 * This is where the two halves of the plan meet. The DEVELOP arrives baked into
 * a cube — the same `composeLutStack` the global correction and the look use,
 * so a local exposure is the very maths of a global one and nothing had to be
 * rewritten in GLSL. The MASK is computed per pixel from `mask.ts`, which a
 * cube could never carry because a cube is handed a colour and no coordinate.
 *
 *     out = mix(under, gradeThroughLut(under), mask × opacity)
 *
 * so a layer at opacity 0, or outside its mask, is the picture untouched to the
 * bit — which is what lets a stack of parked layers cost nothing but a copy.
 *
 * The mask maths MIRRORS `maskAt` exactly and `scripts/check-render.mjs` is
 * what proves the two agree; the shader is deliberately a transcription rather
 * than a re-derivation. It reads IMAGE coordinates (`imageUv`), which is
 * load-bearing here in a way it is not for the lens: a mask is a function of
 * WHERE, so a source whose texture runs the other way would put the darkened
 * sky at the bottom of the frame.
 */

import type { CubeLut } from '../lib/cube-parser';
import type { Interpolation } from '../lut/interpolate';
import { GLSL_VERSION, IMAGE_UV, LUT_LOOKUP, LUT_UNIFORMS } from './glsl';
import { REC709_LUMA, type Mask } from './mask';
import { createCubeTexture } from './cube-pass';
import type { RenderPass } from './graph';

/** What `u_maskKind` means. 0 is "no mask", which covers the whole picture. */
const KIND = { none: 0, linear: 1, radial: 2, luma: 3 } as const;

const FRAGMENT = `${GLSL_VERSION}
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
${LUT_UNIFORMS}
${IMAGE_UV}
${LUT_LOOKUP}

uniform int u_maskKind;
uniform vec2 u_span;        // the frame, in a space whose half-DIAGONAL is 1
uniform vec2 u_maskCentre;  // already in that space
uniform vec2 u_maskDir;     // linear: the direction the mask covers
uniform vec2 u_maskRadius;  // radial: the half-axes
uniform vec2 u_maskRot;     // radial: (cos, sin) of the ellipse's turn
uniform vec2 u_maskBand;    // luma: (from, to)
uniform float u_maskFeather;
uniform float u_invert;
uniform float u_opacity;

// Mirrors maskAt in mask.ts. GLSL's smoothstep IS s*s*(3-2s) clamped, which is
// the same ramp the pure module uses -- do not "improve" one without the other.
float maskValue(vec2 img, float luma) {
  if (u_maskKind == ${KIND.none}) return 1.0;

  if (u_maskKind == ${KIND.luma}) {
    if (u_maskFeather <= 0.0) {
      return (luma >= u_maskBand.x && luma <= u_maskBand.y) ? 1.0 : 0.0;
    }
    float up = smoothstep(0.0, 1.0, (luma - (u_maskBand.x - u_maskFeather)) / u_maskFeather);
    float down = smoothstep(0.0, 1.0, (u_maskBand.y + u_maskFeather - luma) / u_maskFeather);
    return up * down;
  }

  vec2 p = (img - 0.5) * u_span;

  if (u_maskKind == ${KIND.linear}) {
    float t = dot(p - u_maskCentre, u_maskDir);
    if (u_maskFeather <= 0.0) return t >= 0.0 ? 1.0 : 0.0;
    // Centred on the line: the line a panel draws is where the mask reads 0.5.
    return smoothstep(0.0, 1.0, t / u_maskFeather + 0.5);
  }

  vec2 o = p - u_maskCentre;
  // Into the ellipse's own frame.
  vec2 q = vec2(o.x * u_maskRot.x + o.y * u_maskRot.y, -o.x * u_maskRot.y + o.y * u_maskRot.x);
  float e = length(q / max(u_maskRadius, vec2(1e-6)));
  if (u_maskFeather <= 0.0) return e <= 1.0 ? 1.0 : 0.0;
  return smoothstep(0.0, 1.0, (1.0 + u_maskFeather - e) / u_maskFeather);
}

void main() {
  vec4 src = texture(u_src, v_uv);
  float luma = dot(src.rgb, vec3(${REC709_LUMA[0]}, ${REC709_LUMA[1]}, ${REC709_LUMA[2]}));
  float m = maskValue(imageUv(v_uv), luma);
  m = mix(m, 1.0 - m, u_invert);
  m *= u_opacity;
  // Nothing here is a no-op by luck: at m = 0 the mix returns src exactly.
  outColor = vec4(mix(src.rgb, gradeThroughLut(src.rgb), m), src.a);
}`;

export interface LayerPassOptions {
  /** The layer's develop, already baked — `composeLutStack([], 'none', …, develop)`. */
  lut: CubeLut | null;
  mask: Mask | null;
  invert?: boolean;
  /** 0..1. */
  opacity?: number;
  /** The SOURCE's, since a layer is applied before any crop. */
  aspectRatio?: number;
  interpolation?: Interpolation;
  /**
   * Distinguishes this pass from the other layers' in the graph's program
   * cache — programs are keyed by `id`, and every layer shares one shader, so
   * they must NOT share an id or they would share a cache entry and, with it,
   * one uploaded cube.
   */
  id?: string;
}

/**
 * A layer as a pass, or null when it would change nothing — a caller then runs
 * one fewer pass rather than a mix by zero, which still costs a whole round
 * trip through a framebuffer.
 */
export function makeLayerPass(options: LayerPassOptions): RenderPass | null {
  const {
    lut,
    mask,
    invert = false,
    opacity = 1,
    aspectRatio = 1,
    interpolation = 'tetrahedral',
    id = 'layer',
  } = options;
  if (!lut || opacity <= 0) return null;

  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  const span: [number, number] = [(ar / diagonal) * 2, (1 / diagonal) * 2];
  // The centre in the shared space, computed here rather than in the shader so
  // `framePoint` has one implementation and the spec holds it.
  const centre = (m: Mask | null): [number, number] => {
    if (!m || m.kind === 'luma') return [0, 0];
    return [(m.x - 0.5) * span[0], (m.y - 0.5) * span[1]];
  };
  const kind = mask ? KIND[mask.kind] : KIND.none;
  const angle = mask && mask.kind !== 'luma' ? (mask.angle * Math.PI) / 180 : 0;
  const [cx, cy] = centre(mask);

  let uploaded: { gl: WebGL2RenderingContext; tex: WebGLTexture } | null = null;

  return {
    id,
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      const at = (name: string) => gl.getUniformLocation(program, name);
      if (!uploaded || uploaded.gl !== gl) {
        const tex = createCubeTexture(gl, lut);
        uploaded = tex ? { gl, tex } : null;
      }
      gl.uniform1i(at('u_hasLut'), uploaded ? 1 : 0);
      gl.uniform1f(at('u_intensity'), 1);
      gl.uniform1i(at('u_tetra'), interpolation === 'tetrahedral' ? 1 : 0);
      gl.uniform1f(at('u_lutSize'), lut.size);
      gl.uniform3f(at('u_domainMin'), lut.domainMin[0], lut.domainMin[1], lut.domainMin[2]);
      gl.uniform3f(at('u_domainMax'), lut.domainMax[0], lut.domainMax[1], lut.domainMax[2]);
      // Unit 1: unit 0 is the source's sampler2D, and two sampler TYPES on one
      // unit is an INVALID_OPERATION that drops the draw in silence
      // (`render-core.md`). `createCubeTexture` leaves the unit back on 0.
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, uploaded?.tex ?? null);
      gl.uniform1i(at('u_lut'), 1);
      gl.activeTexture(gl.TEXTURE0);

      gl.uniform1i(at('u_maskKind'), kind);
      gl.uniform2f(at('u_span'), span[0], span[1]);
      gl.uniform2f(at('u_maskCentre'), cx, cy);
      gl.uniform2f(at('u_maskDir'), Math.sin(angle), -Math.cos(angle));
      gl.uniform2f(
        at('u_maskRadius'),
        mask && mask.kind === 'radial' ? mask.radiusX : 1,
        mask && mask.kind === 'radial' ? mask.radiusY : 1,
      );
      gl.uniform2f(at('u_maskRot'), Math.cos(angle), Math.sin(angle));
      gl.uniform2f(
        at('u_maskBand'),
        mask && mask.kind === 'luma' ? mask.from : 0,
        mask && mask.kind === 'luma' ? mask.to : 1,
      );
      gl.uniform1f(at('u_maskFeather'), mask ? Math.max(mask.feather, 0) : 0);
      gl.uniform1f(at('u_invert'), invert ? 1 : 0);
      gl.uniform1f(at('u_opacity'), Math.min(1, Math.max(0, opacity)));
    },
  };
}
