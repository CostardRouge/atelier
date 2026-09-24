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
import { REC709_LUMA, colourReach, lumaOf, type Mask, type MaskOp } from './mask';
import { rasteriseBrush, type BrushRaster } from './brush-raster';
import { createCubeTexture } from './cube-pass';
import type { RenderPass } from './graph';

/**
 * What `u_k<i>` means. 0 is "no mask", which covers the whole picture; −1 is a
 * part slot left empty, skipped rather than combined.
 */
const KIND = { off: -1, none: 0, linear: 1, radial: 2, luma: 3, brush: 4, subject: 4, colour: 5 } as const;

/** What `u_op<i>` means — `combineMask`'s three, in this order. */
const OP = { add: 0, subtract: 1, intersect: 2 } as const;

/**
 * The part slots the shader carries beside the layer's own mask. The fragment
 * is the SAME string whatever a layer holds — programs are cached by pass id,
 * so a fragment that changed with the part count would keep running the old
 * one — and an empty slot costs one uniform test.
 */
export const PART_SLOTS = 4;

/** Samples one colour range carries — `MAX_COLOUR_SAMPLES`, restated for the GLSL array. */
const COLOUR_SLOTS = 5;

/** Unit 2 for the layer's own raster, 3 for the subtracted subject, 4.. for the parts'. */
const unitOf = (i: number) => (i === 0 ? 2 : 3 + i);

/**
 * How the pass finishes. `grade` is a layer: the develop mixed in by the mask.
 * `outline` is show-the-mask as a LINE: where the mask crosses one half, drawn
 * in dashes of ink and paper so it reads over any picture — the maintainer's
 * pick for the view while picking (2026-09-23), because a fill hides the very
 * colour being set. Both read the SAME `coverage`, so the line is drawn where
 * the render really cuts.
 */
const MAIN_GRADE = `
void main() {
  vec4 src = texture(u_src, v_uv);
  // Nothing here is a no-op by luck: at m = 0 the mix returns src exactly.
  outColor = vec4(mix(src.rgb, gradeThroughLut(src.rgb), coverage(v_uv)), src.a);
}`;

const MAIN_OUTLINE = `
uniform vec2 u_texel;
void main() {
  vec4 src = texture(u_src, v_uv);
  // The weight without the opacity: a layer at 30 % still has its edge where
  // its mask is.
  float c = coverage(v_uv) / max(u_opacity, 1e-6);
  vec2 d = u_texel * 1.5;
  float a = coverage(v_uv + vec2(d.x, 0.0)) / max(u_opacity, 1e-6);
  float b = coverage(v_uv - vec2(d.x, 0.0)) / max(u_opacity, 1e-6);
  float e = coverage(v_uv + vec2(0.0, d.y)) / max(u_opacity, 1e-6);
  float f = coverage(v_uv - vec2(0.0, d.y)) / max(u_opacity, 1e-6);
  float hi = max(max(max(a, b), max(e, f)), c);
  float lo = min(min(min(a, b), min(e, f)), c);
  float edge = (lo < 0.5 && hi >= 0.5) ? 1.0 : 0.0;
  // Dashes in the render's own pixels, ink and paper, so the line holds over
  // a white sky and a black coat alike.
  float dash = mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 6.0), 2.0);
  vec3 ink = mix(vec3(0.08), vec3(0.97), dash);
  outColor = vec4(mix(src.rgb, ink, edge), src.a);
}`;

/**
 * One component's uniforms and evaluator — `maskAt` for its own kind,
 * transcribed. GLSL's smoothstep IS s*s*(3-2s) clamped, which is the same ramp
 * the pure module uses: do not "improve" one without the other.
 */
const component = (i: number) => `
uniform int u_k${i};
uniform vec2 u_ce${i};   // the centre, already in the half-diagonal space
uniform vec2 u_di${i};   // linear: the direction the mask covers
uniform vec2 u_ra${i};   // radial: the half-axes
uniform vec2 u_ro${i};   // radial: (cos, sin) of the ellipse's turn
uniform vec2 u_ba${i};   // luma: (from, to)
uniform float u_fe${i};
uniform float u_iv${i};
uniform int u_op${i};
uniform int u_cn${i};                  // colour: how many samples
uniform vec3 u_co${i}[${COLOUR_SLOTS}];  // colour: each sample, in the opponent space
uniform float u_rg${i};                // colour: the reach
// The RASTER kinds -- a painted mask (brush-raster.ts) and a segmented
// subject -- share one branch, because by the time they reach here they are
// the same thing: an alpha map in image order. Bound even when unused, for the
// same reason the cube is: an unset sampler defaults to unit 0.
uniform sampler2D u_tx${i};
float maskValue${i}(vec2 img, vec3 rgb, float luma) {
  if (u_k${i} == ${KIND.none}) return 1.0;
  // Row 0 of the map is the TOP of the picture, which is what imageUv already
  // gives, so no flip enters here.
  if (u_k${i} == ${KIND.brush}) return texture(u_tx${i}, img).r;
  if (u_k${i} == ${KIND.colour}) {
    // colourRangeAt: the nearest sample decides.
    vec3 o = vec3(rgb.r - rgb.g, (rgb.r + rgb.g) * 0.5 - rgb.b, luma);
    float best = 0.0;
    for (int k = 0; k < ${COLOUR_SLOTS}; k++) {
      if (k >= u_cn${i}) break;
      vec3 q = o - u_co${i}[k];
      float dist = length(vec3(q.x, q.y, q.z * 0.5));
      best = max(best, 1.0 - smoothstep(0.0, 1.0, (dist - u_rg${i}) / u_rg${i}));
    }
    return best;
  }
  if (u_k${i} == ${KIND.luma}) {
    if (u_fe${i} <= 0.0) {
      return (luma >= u_ba${i}.x && luma <= u_ba${i}.y) ? 1.0 : 0.0;
    }
    float up = smoothstep(0.0, 1.0, (luma - (u_ba${i}.x - u_fe${i})) / u_fe${i});
    float down = smoothstep(0.0, 1.0, (u_ba${i}.y + u_fe${i} - luma) / u_fe${i});
    return up * down;
  }
  vec2 p = (img - 0.5) * u_span;
  if (u_k${i} == ${KIND.linear}) {
    float t = dot(p - u_ce${i}, u_di${i});
    if (u_fe${i} <= 0.0) return t >= 0.0 ? 1.0 : 0.0;
    // Centred on the line: the line a panel draws is where the mask reads 0.5.
    return smoothstep(0.0, 1.0, t / u_fe${i} + 0.5);
  }
  vec2 o = p - u_ce${i};
  // Into the ellipse's own frame.
  vec2 q = vec2(o.x * u_ro${i}.x + o.y * u_ro${i}.y, -o.x * u_ro${i}.y + o.y * u_ro${i}.x);
  float e = length(q / max(u_ra${i}, vec2(1e-6)));
  if (u_fe${i} <= 0.0) return e <= 1.0 ? 1.0 : 0.0;
  return smoothstep(0.0, 1.0, (1.0 + u_fe${i} - e) / u_fe${i});
}`;

const partStep = (i: number) => `
  if (u_k${i} != ${KIND.off}) {
    float v${i} = maskValue${i}(img, src.rgb, luma);
    m = combineMask(m, mix(v${i}, 1.0 - v${i}, u_iv${i}), u_op${i});
  }`;

const fragment = (finish: string) => `${GLSL_VERSION}
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
${LUT_UNIFORMS}
${IMAGE_UV}
${LUT_LOOKUP}

uniform vec2 u_span;        // the frame, in a space whose half-DIAGONAL is 1
uniform float u_opacity;
// The SUBTRACTED subject's alpha map, on unit 3 (AdjustLayer.except), and
// whether there is one: the same raster a subject layer draws with, taken out.
uniform sampler2D u_exceptTex;
uniform float u_hasExcept;
${Array.from({ length: PART_SLOTS + 1 }, (_, i) => component(i)).join('\n')}

// Mirrors combineMask in mask.ts.
float combineMask(float m, float v, int op) {
  if (op == ${OP.subtract}) return m * (1.0 - v);
  if (op == ${OP.intersect}) return m * v;
  return max(m, v);
}

// Mirrors layerWeight in layer.ts: the layer's own mask turned by its invert,
// each part combined in order (turned by its own), THEN holed by the
// subtracted subject, then scaled -- the hole stays a hole either way round.
float coverage(vec2 uv) {
  vec4 src = texture(u_src, uv);
  float luma = dot(src.rgb, vec3(${REC709_LUMA[0]}, ${REC709_LUMA[1]}, ${REC709_LUMA[2]}));
  vec2 img = imageUv(uv);
  float m = maskValue0(img, src.rgb, luma);
  m = mix(m, 1.0 - m, u_iv0);
${Array.from({ length: PART_SLOTS }, (_, i) => partStep(i + 1)).join('')}
  m *= 1.0 - u_hasExcept * texture(u_exceptTex, img).r;
  return m * u_opacity;
}
${finish}`;

/** One part, as the pass takes it — `MaskPart` in `develop/layer.ts`, restated so render/ never imports develop/. */
export interface LayerPassPart {
  op: MaskOp;
  mask: Mask;
  invert: boolean;
}

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
   * The alpha map, for the two RASTER kinds. A segmented subject's is always
   * the caller's — this module has no model. A painted mask's is rasterised
   * here when the caller says nothing (`undefined`); a caller that already
   * holds the raster for these very strokes (`layer-render.ts`'s cache) hands
   * it over so an opacity nudge does not walk a million texels again. `null`
   * is an empty map. Ignored for every other kind.
   */
  raster?: BrushRaster | null;
  /**
   * The alpha map of the subject SUBTRACTED from this layer
   * (`AdjustLayer.except`), or null for none — a subject whose answer has not
   * arrived subtracts nothing yet, rather than blanking the layer.
   */
  except?: BrushRaster | null;
  /**
   * Further masks COMBINED with `mask`, in order (`MaskPart`, item 16). At
   * most `PART_SLOTS`; a subject part is not one this pass can resolve and is
   * the caller's to refuse.
   */
  parts?: readonly LayerPassPart[];
  /**
   * Each part's alpha map, by index, for a PAINTED part — the same contract
   * as `raster`: `undefined` rasterises here, `null` is an empty map.
   */
  partRasters?: readonly (BrushRaster | null | undefined)[];
  /** `grade` (default) is a layer; `outline` draws where the mask crosses one half. */
  finish?: 'grade' | 'outline';
  /**
   * Distinguishes this pass from the other layers' in the graph's program
   * cache — programs are keyed by `id`, and every layer shares one shader, so
   * they must NOT share an id or they would share a cache entry and, with it,
   * one uploaded cube.
   */
  id?: string;
}

/** One component — the layer's own mask, or a part — as the numbers its uniforms take. */
interface Component {
  kind: number;
  op: number;
  invert: boolean;
  centre: [number, number];
  dir: [number, number];
  radius: [number, number];
  rot: [number, number];
  band: [number, number];
  feather: number;
  colours: [number, number, number][];
  reach: number;
  raster: BrushRaster | null;
}

const OFF: Component = {
  kind: KIND.off,
  op: OP.add,
  invert: false,
  centre: [0, 0],
  dir: [0, -1],
  radius: [1, 1],
  rot: [1, 0],
  band: [0, 1],
  feather: 0,
  colours: [],
  reach: 1,
  raster: null,
};

/**
 * A mask's uniforms. The centre goes into the shared space HERE rather than
 * in the shader, so `framePoint` has one implementation and the spec holds it.
 * A painted mask is rasterised once per pass, not per draw — and not at all
 * when the caller already holds the map for these strokes. A SUBJECT cannot
 * be rasterised here (it takes a model and an await), so its map is always the
 * caller's.
 */
function componentOf(
  mask: Mask | null,
  invert: boolean,
  op: MaskOp,
  span: [number, number],
  aspectRatio: number,
  given: BrushRaster | null | undefined,
): Component {
  const shaped = mask && (mask.kind === 'linear' || mask.kind === 'radial') ? mask : null;
  const angle = shaped ? (shaped.angle * Math.PI) / 180 : 0;
  const raster =
    mask?.kind === 'brush'
      ? given !== undefined
        ? given
        : mask.strokes.length
          ? rasteriseBrush(mask.strokes, aspectRatio)
          : null
      : mask?.kind === 'subject'
        ? (given ?? null)
        : null;
  return {
    kind: mask ? KIND[mask.kind] : KIND.none,
    op: OP[op],
    invert,
    centre: shaped ? [(shaped.x - 0.5) * span[0], (shaped.y - 0.5) * span[1]] : [0, 0],
    dir: [Math.sin(angle), -Math.cos(angle)],
    radius: mask?.kind === 'radial' ? [mask.radiusX, mask.radiusY] : [1, 1],
    rot: [Math.cos(angle), Math.sin(angle)],
    band: mask?.kind === 'luma' ? [mask.from, mask.to] : [0, 1],
    feather: shaped || mask?.kind === 'luma' ? Math.max((mask as { feather: number }).feather, 0) : 0,
    // The samples go in already in the OPPONENT space the shader compares in,
    // so the per-pixel work is the pixel's own conversion alone.
    colours:
      mask?.kind === 'colour'
        ? mask.samples.map((c) => [c.r - c.g, (c.r + c.g) * 0.5 - c.b, lumaOf(c.r, c.g, c.b)] as [number, number, number])
        : [],
    reach: mask?.kind === 'colour' ? colourReach(mask.range) : 1,
    raster,
  };
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
    finish = 'grade',
  } = options;
  const except = options.except ?? null;
  if (!lut || opacity <= 0) return null;

  const ar = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const diagonal = Math.hypot(ar, 1);
  const span: [number, number] = [(ar / diagonal) * 2, (1 / diagonal) * 2];
  const parts = (options.parts ?? []).slice(0, PART_SLOTS);
  const components: Component[] = [
    componentOf(mask, invert, 'add', span, ar, options.raster),
    ...Array.from({ length: PART_SLOTS }, (_, k) => {
      const part = parts[k];
      return part ? componentOf(part.mask, part.invert, part.op, span, ar, options.partRasters?.[k]) : OFF;
    }),
  ];

  let uploaded: { gl: WebGL2RenderingContext; tex: WebGLTexture } | null = null;
  // One alpha map per component, and the subtracted subject's.
  let maskTex: ({ gl: WebGL2RenderingContext; tex: WebGLTexture } | null)[] = [];
  let exceptTex: { gl: WebGL2RenderingContext; tex: WebGLTexture } | null = null;

  return {
    id,
    fragment: finish === 'outline' ? fragment(MAIN_OUTLINE) : fragment(MAIN_GRADE),
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

      // Unit 3: the subtracted subject. Bound even when there is none, like
      // every sampler here — an unbound one reads unit 0, where the source is.
      if (!exceptTex || exceptTex.gl !== gl) exceptTex = alphaTexture(gl, except, gl.TEXTURE3);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, exceptTex?.tex ?? null);
      gl.uniform1i(at('u_exceptTex'), 3);
      gl.uniform1f(at('u_hasExcept'), except ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);

      gl.uniform2f(at('u_span'), span[0], span[1]);
      gl.uniform1f(at('u_opacity'), Math.min(1, Math.max(0, opacity)));

      components.forEach((c, i) => {
        // Unit 2 for the layer's own map, 4.. for the parts': an unset
        // sampler defaults to unit 0, where the source already is. A painted
        // mask with no strokes covers NOTHING, unlike every other kind — an
        // empty shape is empty, and treating it as the whole picture would
        // make a fresh brush layer apply everywhere.
        const unit = unitOf(i);
        const held = maskTex[i];
        if (!held || held.gl !== gl) maskTex[i] = alphaTexture(gl, c.raster, gl.TEXTURE0 + unit);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, maskTex[i]?.tex ?? null);
        gl.uniform1i(at(`u_tx${i}`), unit);
        gl.activeTexture(gl.TEXTURE0);

        gl.uniform1i(at(`u_k${i}`), c.kind);
        gl.uniform1i(at(`u_op${i}`), c.op);
        gl.uniform1f(at(`u_iv${i}`), c.invert ? 1 : 0);
        gl.uniform2f(at(`u_ce${i}`), c.centre[0], c.centre[1]);
        gl.uniform2f(at(`u_di${i}`), c.dir[0], c.dir[1]);
        gl.uniform2f(at(`u_ra${i}`), c.radius[0], c.radius[1]);
        gl.uniform2f(at(`u_ro${i}`), c.rot[0], c.rot[1]);
        gl.uniform2f(at(`u_ba${i}`), c.band[0], c.band[1]);
        gl.uniform1f(at(`u_fe${i}`), c.feather);
        gl.uniform1i(at(`u_cn${i}`), c.colours.length);
        gl.uniform1f(at(`u_rg${i}`), c.reach);
        const flat = new Float32Array(COLOUR_SLOTS * 3);
        c.colours.slice(0, COLOUR_SLOTS).forEach((col, k) => flat.set(col, k * 3));
        gl.uniform3fv(at(`u_co${i}`), flat);
      });
    },
    dispose(gl) {
      // A graph now OUTLIVES its pass list (`setExtraPasses`), so the textures
      // a layer uploads are no longer freed by the context dying with it. One
      // layer's cube is a megabyte at 33 lattice points; a drag that leaked
      // one per step would fill a GPU in seconds.
      if (uploaded?.gl === gl) gl.deleteTexture(uploaded.tex);
      for (const t of maskTex) if (t?.gl === gl) gl.deleteTexture(t.tex);
      if (exceptTex?.gl === gl) gl.deleteTexture(exceptTex.tex);
      uploaded = null;
      maskTex = [];
      exceptTex = null;
    },
  };
}

/**
 * An alpha map as an R8 texture on `unit`, or one EMPTY texel. Zero rather
 * than one, because a brush mask with no strokes reads this and must cover
 * nothing — an empty shape is empty, and 255 here would make a fresh brush
 * layer apply to the whole picture — and an absent subtraction takes nothing
 * out. NOT flipped: row 0 of the map is the top of the picture, which is what
 * `imageUv` hands the sampler.
 */
function alphaTexture(
  gl: WebGL2RenderingContext,
  raster: BrushRaster | null,
  unit: GLenum,
): { gl: WebGL2RenderingContext; tex: WebGLTexture } | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (raster) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, raster.width, raster.height, 0, gl.RED, gl.UNSIGNED_BYTE, raster.data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  }
  gl.activeTexture(gl.TEXTURE0);
  return { gl, tex };
}
