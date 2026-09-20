/**
 * The `FilmNode` — a stock's TEXTURE, grain and halation, as ONE node of the
 * graph.
 *
 * Why one node and not two, and why here rather than in `lut-gl.ts`: both are
 * SPATIAL — grain is a field sampled in frame coordinates, halation reads a
 * neighbourhood — so neither can ride the cube every renderer takes, and
 * building the multi-pass machinery for them a second time inside the old
 * renderer was declined (`docs/film-simulation.md` §4.5). The maths is not
 * re-derived here: every formula is a TRANSCRIPTION of the pure module beside
 * it (`film-grain.ts`, `film-noise.ts`, `film-texture.ts`), which is what lets
 * `scripts/check-render.mjs` hold the GPU to it by `readPixels` — the
 * `layer-pass.ts` rule.
 *
 * THREE THINGS DECIDE ITS SHAPE.
 *
 * **Its position is fixed, never author-ordered.** It sits between the LOOK
 * and the OUTPUT: `SOURCE → CUBE → [FILM] → OUTPUT` is the fast path a CLIP
 * takes, and on a still it is the last node of all — grain that a sharpen or a
 * warp then resampled would be neither grain nor sharp. `graph-grader.ts`
 * appends it; no caller places it.
 *
 * **It needs the OUTPUT resolution and a SOURCE frame index.** Grain is the
 * one node whose result must survive a downscale that happens AFTER the graph,
 * so its cell is a fraction of the frame's height (`grainUniforms`) and the
 * field is a tile read LINEAR at one texel per cell, never a per-fragment
 * hash. Its field re-rolls per SOURCE frame quantised to `grainFps`
 * (`grainFrameIndex` / `grainPhase`), never per rAF: a still is frame 0 and a
 * re-export a year later is byte-identical.
 *
 * **Halation cannot be passes of the graph.** Every pass there draws at the
 * render size into one of two ping-pong targets; the halo is extracted and
 * blurred in a SMALL buffer whose size and sigma depend on the RADIUS alone
 * (`halationBuffer`) — which is what makes halation resolution-independent by
 * construction, and what keeps a 48 MP export from allocating a 192 MB
 * intermediate. So the node owns those buffers and renders them in
 * `RenderPass.prepare`.
 */

import {
  MAX_HALATION_TAPS,
  gaussianKernel,
  halationTaps,
  OCTAVE_SCALE,
  OCTAVE_WEIGHT,
  GRAIN_GAIN,
} from '../film/film-grain';
import { grainFrameIndex, grainPhase, makeGrainNoise } from '../film/film-noise';
import {
  NOISE_SIZE,
  grainUniforms,
  halationBuffer,
  isSilentTexture,
  type FilmTexture,
} from '../film/film-texture';
import { GLSL_VERSION } from './glsl';
import { linkPassProgram, type PassInput, type RenderPass } from './graph';

/**
 * The quad's own coordinate, whichever way `u_flipY` turned `v_uv`.
 *
 * The halo buffer is written in SCREEN order (a framebuffer write is by
 * `gl_Position`, which no flip touches), so it must be READ in screen order
 * too or the bleed lands mirrored for one of the two source kinds. The node is
 * never the first pass — the cube always precedes it — so `u_flipY` is 0 in
 * practice and this is the identity; it is written out because "in practice"
 * is exactly how the keystone shipped upside down (`render-geometry.md`).
 */
const QUAD_UV = `
uniform float u_flipY;
vec2 quadUv(vec2 uv) { return vec2(uv.x, mix(uv.y, 1.0 - uv.y, u_flipY)); }
`;

/** `extractHighlight`, verbatim, at the halo buffer's own size. */
const EXTRACT_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform float u_threshold;
void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float span = max(1e-6, 1.0 - u_threshold);
  float e = clamp((l - u_threshold) / span, 0.0, 1.0);
  outColor = vec4(c * e, 1.0);
}`;

/**
 * One axis of `blurSeparable`, with CLAMP_TO_EDGE (the texture's own wrap) and
 * the weights of `gaussianKernel` handed in as a uniform array — so there is
 * ONE kernel implementation in the repo and it is the tested one.
 */
const BLUR_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_step;      // one texel along this axis, zero along the other
uniform float u_weights[${MAX_HALATION_TAPS}];
uniform int u_taps;
void main() {
  int half_ = (u_taps - 1) / 2;
  vec3 acc = vec3(0.0);
  for (int k = 0; k < ${MAX_HALATION_TAPS}; k++) {
    if (k >= u_taps) break;
    acc += texture(u_src, v_uv + u_step * float(k - half_)).rgb * u_weights[k];
  }
  outColor = vec4(acc, 1.0);
}`;

/**
 * The node's own draw: the halo screened on, then the grain — halation first
 * because light scatters at EXPOSURE and silver develops after.
 *
 * `grainWeight`, `applyGrain`, `screenHalation` and `combineOctaves`
 * transcribed; `u_grainAmount` already carries the fade, which is the only
 * resolution-dependent term and is deliberately so (a cell finer than the
 * preview can resolve fades out rather than aliasing).
 */
const FILM_FRAGMENT = `${GLSL_VERSION}
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_noise;
uniform sampler2D u_halo;
uniform vec2 u_grainScale;   // aspect * scale, from grainUniforms
uniform vec2 u_grainPhase;
uniform float u_grainAmount; // amount * fade
uniform float u_grainChroma;
uniform float u_halation;
uniform vec3 u_halationTint;
uniform bool u_hasHalo;
${QUAD_UV}

/** One read of the tile, as a sample: alpha is the luma field, rgb the three. */
vec4 noiseAt(vec2 uv) {
  vec4 t = texture(u_noise, uv);
  return vec4(t.a, t.r, t.g, t.b) - vec4(0.5);
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 c = src.rgb;
  vec2 quad = quadUv(v_uv);

  // Halation, then grain — and each is the IDENTITY where its own term is
  // zero, never 1 minus (1 minus c) and never a clamp: an untouched pixel must
  // come back untouched, headroom included. NB: no backtick in a GLSL comment,
  // it ends the template literal (media-pipeline.md).
  if (u_hasHalo) {
    vec3 e = clamp(texture(u_halo, quad).rgb, 0.0, 1.0) * clamp(u_halation, 0.0, 1.0);
    vec3 h = clamp(e * u_halationTint, 0.0, 1.0);
    if (any(greaterThan(e, vec3(0.0)))) c = 1.0 - (1.0 - clamp(c, 0.0, 1.0)) * (1.0 - h);
  }

  float l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  float weight = pow(4.0 * l * (1.0 - l), 0.75) * (1.0 - 0.35 * l);
  float k = u_grainAmount * weight * ${GRAIN_GAIN.toFixed(4)};
  if (k > 0.0) {
    vec2 uv = quad * u_grainScale + u_grainPhase;
    vec4 n = noiseAt(uv);
    vec4 o = noiseAt(uv * ${OCTAVE_SCALE.toFixed(6)});
    n = (n + ${OCTAVE_WEIGHT.toFixed(6)} * o) * ${(1 / Math.sqrt(1 + OCTAVE_WEIGHT * OCTAVE_WEIGHT)).toFixed(9)};
    vec3 field = n.x + (n.yzw - n.x) * u_grainChroma;
    c = clamp(c + k * field, 0.0, 1.0);
  }

  outColor = vec4(c, src.a);
}`;

const at = (gl: WebGL2RenderingContext, program: WebGLProgram, name: string) =>
  gl.getUniformLocation(program, name);

/**
 * The texture units this node's own samplers live on.
 *
 * Unit 0 is the graph's input, and unit 1 is NOT free: the cube pass — which
 * always runs before this one — leaves its `sampler3D` bound there. Two
 * sampler types on one unit is the very trap `render-core.md` records, and
 * while a program that samples only 2D is within its rights, there is nothing
 * to gain by standing on it.
 */
const NOISE_UNIT = { unit: 0x84c2 as const, index: 2 }; // gl.TEXTURE2
const HALO_UNIT = { unit: 0x84c3 as const, index: 3 }; // gl.TEXTURE3

interface Buffer {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

export interface FilmPass extends RenderPass {
  /**
   * Which SOURCE instant the next draw is of — a clip's frame time, in the
   * clip's own seconds. A still never calls it and stays on field 0.
   */
  setSourceSeconds(seconds: number): void;
}

/**
 * The node for one texture at one render size, or null when there is nothing
 * to draw (`isSilentTexture`) — a silent stock must cost not one pass, so an
 * unfilmed picture is bit-identical to what it was before the node existed.
 *
 * The GL objects are made lazily against the graph's own context, on the first
 * `prepare`, and freed by `dispose` — which the graph now calls when a pass is
 * REPLACED as well as when it goes (`RenderPass.dispose`).
 */
export function makeFilmPass(
  texture: FilmTexture,
  width: number,
  height: number,
): FilmPass | null {
  if (isSilentTexture(texture)) return null;

  const uniforms = grainUniforms(texture, width, height);
  const halo = halationBuffer(texture, width, height);
  const kernel = halo ? gaussianKernel(halo.sigma, halationTaps(halo.sigma)) : [];
  const weights = new Float32Array(MAX_HALATION_TAPS);
  weights.set(kernel);

  let sourceSeconds = 0;
  let noiseTex: WebGLTexture | null = null;
  let extract: WebGLProgram | null = null;
  let blur: WebGLProgram | null = null;
  const buffers: (Buffer | null)[] = [null, null];
  let built = false;
  let haloReady = false;

  const bufferAt = (gl: WebGL2RenderingContext, index: 0 | 1): Buffer | null => {
    const held = buffers[index];
    if (held || !halo) return held;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // The halo is a smooth, blurred field read back with LINEAR at the render
    // size, and CLAMP_TO_EDGE is what `blurSeparable` clamps like.
    //
    // Half-float where the GPU will render to it, and the reason is the whole
    // point of the graph: a highlight ABOVE white is exactly what bleeds, and
    // an 8-bit halo buffer would clip it away before the blur ever saw it.
    const renderable = Boolean(
      gl.getExtension('EXT_color_buffer_half_float') ?? gl.getExtension('EXT_color_buffer_float'),
    );
    const internal = renderable ? gl.RGBA16F : gl.RGBA8;
    const type = renderable ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, halo.w, halo.h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const made: Buffer = { fbo, tex, width: halo.w, height: halo.h };
    buffers[index] = made;
    return made;
  };

  const build = (gl: WebGL2RenderingContext) => {
    if (built) return;
    built = true;
    noiseTex = gl.createTexture();
    gl.activeTexture(NOISE_UNIT.unit);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    // SAY the unpack state; never inherit it. `UNPACK_FLIP_Y_WEBGL` is global
    // to the context and the graph leaves it TRUE after a source upload —
    // except where the cube pass created its 3D texture in the same render,
    // which turns it off and leaves it off. So the tile was uploaded flipped
    // or not depending on whether the LOOK happened to be re-uploaded that
    // frame: a grader built with a texture and the same grader SWAPPED onto
    // one drew two different fields, which the render gate caught and nothing
    // else could have. The tile is generated in row order and read in row
    // order (`sampleGrainTile`), so the flip is off.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      NOISE_SIZE,
      NOISE_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      makeGrainNoise(texture.seed),
    );
    // REPEAT: the tile is meant to wrap, and it is the second octave's
    // irrational frequency that hides the period, not the tile's edges.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    // LINEAR is load-bearing, not a default: the bilinear read IS the
    // band-limiting filter the whole design rests on.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (halo) {
      extract = linkPassProgram(gl, EXTRACT_FRAGMENT);
      blur = linkPassProgram(gl, BLUR_FRAGMENT);
    }
  };

  return {
    // ONE id for every film node: the fragment is constant and the graph
    // caches its programs by id, so a stock whose dials moved reuses the
    // program it already linked.
    id: 'film',
    fragment: FILM_FRAGMENT,

    setSourceSeconds(seconds) {
      sourceSeconds = seconds;
    },

    prepare(gl, input: PassInput) {
      build(gl);
      haloReady = false;
      if (!halo || !extract || !blur) return;
      const a = bufferAt(gl, 0);
      const b = bufferAt(gl, 1);
      if (!a || !b) return;

      // Extract, at the halo buffer's own size — never a full-resolution
      // intermediate. The input is read with the pass's own flip so the halo
      // is written in screen order, which is how the node reads it back.
      gl.useProgram(extract);
      gl.uniform1f(at(gl, extract, 'u_flipY'), input.flipY);
      gl.uniform1f(at(gl, extract, 'u_threshold'), texture.halationThreshold);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input.texture);
      gl.uniform1i(at(gl, extract, 'u_src'), 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      gl.viewport(0, 0, a.width, a.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Then the separable blur, a → b → a. `u_flipY` is left at 0 for both:
      // an FBO round trip is neutral under one convention, and flipping on one
      // axis of a separable blur and not the other is how a blur turns into a
      // shear.
      gl.useProgram(blur);
      gl.uniform1f(at(gl, blur, 'u_flipY'), 0);
      gl.uniform1fv(at(gl, blur, 'u_weights'), weights);
      gl.uniform1i(at(gl, blur, 'u_taps'), kernel.length);
      gl.uniform1i(at(gl, blur, 'u_src'), 0);
      const axis = (from: Buffer, to: Buffer, dx: number, dy: number) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform2f(at(gl, blur!, 'u_step'), dx / from.width, dy / from.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
        gl.viewport(0, 0, to.width, to.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      };
      axis(a, b, 1, 0);
      axis(b, a, 0, 1);
      haloReady = true;
    },

    setUniforms(gl, program) {
      gl.activeTexture(NOISE_UNIT.unit);
      gl.bindTexture(gl.TEXTURE_2D, noiseTex);
      gl.uniform1i(at(gl, program, 'u_noise'), NOISE_UNIT.index);

      // A sampler left unset defaults to unit 0, where the source already is —
      // two sampler types on one unit is an INVALID_OPERATION that drops the
      // draw silently (`render-core.md`). The halo's unit is bound whether or
      // not there is a halo; `u_hasHalo` is what decides the read.
      gl.activeTexture(HALO_UNIT.unit);
      gl.bindTexture(gl.TEXTURE_2D, haloReady ? (buffers[0]?.tex ?? noiseTex) : noiseTex);
      gl.uniform1i(at(gl, program, 'u_halo'), HALO_UNIT.index);
      gl.uniform1i(at(gl, program, 'u_hasHalo'), haloReady ? 1 : 0);

      const [px, py] = grainPhase(
        grainFrameIndex(sourceSeconds, texture.grainFps),
        texture.seed,
      );
      gl.uniform2f(
        at(gl, program, 'u_grainScale'),
        uniforms.aspect[0] * uniforms.scale,
        uniforms.aspect[1] * uniforms.scale,
      );
      gl.uniform2f(at(gl, program, 'u_grainPhase'), px, py);
      gl.uniform1f(at(gl, program, 'u_grainAmount'), uniforms.amount * uniforms.fade);
      gl.uniform1f(at(gl, program, 'u_grainChroma'), uniforms.chroma);
      gl.uniform1f(at(gl, program, 'u_halation'), texture.halation);
      gl.uniform3f(
        at(gl, program, 'u_halationTint'),
        texture.halationTint[0],
        texture.halationTint[1],
        texture.halationTint[2],
      );
      gl.activeTexture(gl.TEXTURE0);
    },

    dispose(gl) {
      if (noiseTex) gl.deleteTexture(noiseTex);
      noiseTex = null;
      for (const buffer of buffers) {
        if (!buffer) continue;
        gl.deleteFramebuffer(buffer.fbo);
        gl.deleteTexture(buffer.tex);
      }
      buffers[0] = null;
      buffers[1] = null;
      if (extract) gl.deleteProgram(extract);
      if (blur) gl.deleteProgram(blur);
      extract = null;
      blur = null;
      built = false;
      haloReady = false;
    },
  };
}
