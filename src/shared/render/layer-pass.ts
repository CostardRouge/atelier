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
import { rasteriseBrush } from './brush-raster';
import { createCubeTexture } from './cube-pass';
import type { RenderPass } from './graph';

/** What `u_maskKind` means. 0 is "no mask", which covers the whole picture. */
const KIND = { none: 0, linear: 1, radial: 2, luma: 3, brush: 4 } as const;

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
// The painted mask's alpha map, on unit 2. Bound even when unused, for the same
// reason the cube is: an unset sampler defaults to unit 0.
uniform sampler2D u_maskTex;

// Mirrors maskAt in mask.ts. GLSL's smoothstep IS s*s*(3-2s) clamped, which is
// the same ramp the pure module uses -- do not "improve" one without the other.
float maskValue(vec2 img, float luma) {
  if (u_maskKind == ${KIND.none}) return 1.0;

  // A painted mask is the one kind the CPU rasterises (brush-raster.ts): a
  // shader walking every segment of every stroke per pixel would cost pixels x
  // points. Row 0 of the map is the TOP of the picture, which is what imageUv
  // already gives, so no flip enters here.
  if (u_maskKind == ${KIND.brush}) return texture(u_maskTex, img).r;

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
    if (!m || m.kind === 'luma' || m.kind === 'brush') return [0, 0];
    return [(m.x - 0.5) * span[0], (m.y - 0.5) * span[1]];
  };
  const kind = mask ? KIND[mask.kind] : KIND.none;
  const shaped = mask && (mask.kind === 'linear' || mask.kind === 'radial') ? mask : null;
  const angle = shaped ? (shaped.angle * Math.PI) / 180 : 0;
  const [cx, cy] = centre(mask);
  // Rasterised ONCE per pass, not per draw: a pass is rebuilt whenever the
  // mask changes by value, so this is exactly as often as the strokes move.
  const raster = mask?.kind === 'brush' && mask.strokes.length ? rasteriseBrush(mask.strokes, ar) : null;

  let uploaded: { gl: WebGL2RenderingContext; tex: WebGLTexture } | null = null;
  let maskTex: { gl: WebGL2RenderingContext; tex: WebGLTexture } | null = null;

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

      // Unit 2, for the same reason the cube takes unit 1: an unset sampler
      // defaults to unit 0, where the source already is.
      if (!maskTex || maskTex.gl !== gl) {
        const tex = gl.createTexture();
        if (tex) {
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          // NOT flipped: row 0 of the map is the top of the picture, which is
          // what `imageUv` hands the sampler.
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          if (raster) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, raster.width, raster.height, 0, gl.RED, gl.UNSIGNED_BYTE, raster.data);
          } else {
            // One EMPTY texel. Zero rather than one, because a brush mask with
            // no strokes reads this and must cover nothing — an empty shape is
            // empty, and 255 here would make a fresh brush layer apply to the
            // whole picture. Every other kind never samples it.
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
          }
          maskTex = { gl, tex };
        }
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, maskTex?.tex ?? null);
      gl.uniform1i(at('u_maskTex'), 2);
      gl.activeTexture(gl.TEXTURE0);

      // A painted mask with no strokes covers NOTHING, unlike every other kind
      // — an empty shape is empty, and treating it as the whole picture would
      // make a fresh brush layer apply everywhere.
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
      gl.uniform1f(at('u_maskFeather'), mask && mask.kind !== 'brush' ? Math.max(mask.feather, 0) : 0);
      gl.uniform1f(at('u_invert'), invert ? 1 : 0);
      gl.uniform1f(at('u_opacity'), Math.min(1, Math.max(0, opacity)));
    },
    dispose(gl) {
      // A graph now OUTLIVES its pass list (`setExtraPasses`), so the two
      // textures a layer uploads are no longer freed by the context dying with
      // it. One layer's cube is a megabyte at 33 lattice points; a drag that
      // leaked one per step would fill a GPU in seconds.
      if (uploaded?.gl === gl) gl.deleteTexture(uploaded.tex);
      if (maskTex?.gl === gl) gl.deleteTexture(maskTex.tex);
      uploaded = null;
      maskTex = null;
    },
  };
}
