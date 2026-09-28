/**
 * The render core: one WebGL2 context, a full-screen quad, and N passes over
 * float16 buffers.
 *
 * `lut-gl.ts` is ONE pass over 8-bit pixels, which is all a look needs and is
 * why it served for a year. A mask needs to know where a pixel is, a keystone
 * needs geometry, a denoise needs its neighbours and a highlight needs values
 * above white — none of which a single 8-bit pass can carry
 * (`docs/photo-editor.md` §2.2). This is the pipeline those ride on.
 *
 * Three things it is built around:
 *
 * - **At one pass it IS the old renderer.** `planPasses(1)` is source → canvas
 *   with no framebuffer bound, so the common case costs nothing for the core
 *   existing and comes out pixel-identical. The plan is pure and tested apart
 *   (`pass-plan.ts`).
 * - **The buffers are float16, the VALUES are unchanged.** `RGBA16F` is for
 *   precision and for headroom above white; the numbers passing through stay in
 *   the same sRGB-encoded domain the cube already speaks, so no existing maths
 *   moves. A pass that wants linear light decodes and encodes inside itself.
 *   Working space is a decision for the phase that needs one, not a side effect
 *   of changing buffer format.
 * - **A platform that cannot render to float16 says so** (`precision`) and
 *   falls back to 8-bit rather than failing. What is lost is the headroom, and
 *   a caller that promises it must ask.
 *
 * Framework-free, like the renderer it grows from.
 */

import { bandFragment, OWN_ROWS, planBands, type BandPlan, type RowNeed, type RowSpan } from './band-plan';
import { VERTEX_SRC } from './glsl';
import { isHalfImage, type HalfImage } from './half-image';
import { planPasses, targetsNeeded, type PassSlot } from './pass-plan';

/** What the intermediate buffers can hold. */
export type RenderPrecision = 'float16' | 'byte';

/** Anything the graph draws from: an 8-bit browser source, or a half-float picture of our own. */
export type RenderSource = TexImageSource | HalfImage;

/**
 * What a pass is about to read, handed to `prepare` — everything a pass needs
 * to render something of its OWN before the graph draws it.
 */
export interface PassInput {
  /** The texture this pass will read as `u_src`: the source, or what the pass before it wrote. */
  texture: WebGLTexture | null;
  /** The render size, in pixels. A pass's own buffers may be any size at all. */
  width: number;
  height: number;
  /** The `u_flipY` this pass's own draw will use, so a sub-render reads the picture the same way up. */
  flipY: number;
}

export interface RenderPass {
  /** For a message when a pass will not compile. */
  id: string;
  /** The whole fragment shader. It reads `v_uv` and `u_src`, and writes `outColor`. */
  fragment: string;
  /**
   * Render something of this pass's OWN, into buffers it owns, before the
   * graph draws it — the halation halo, which is extracted and blurred at a
   * SMALL size (`film-texture.ts`, `halationBuffer`) and so cannot be a pass
   * of the graph: every pass here draws at the render size into one of two
   * ping-pong targets, by construction.
   *
   * The contract, so a sub-render cannot disturb the draw that follows:
   * - the graph's quad VAO is bound and attribute 0 IS the quad, so a program
   *   linked with `linkPassProgram` can draw with it and needs no buffer;
   * - nothing has to be restored — the graph re-binds its program, its
   *   framebuffer, its viewport, texture unit 0 and all of its own uniforms
   *   after this returns;
   * - the graph's own targets are not this pass's to delete.
   */
  prepare?: (gl: WebGL2RenderingContext, input: PassInput) => void;
  /**
   * Bind anything beyond `u_src`. Called with the program already in use and
   * texture unit 0 taken by the input; a pass uses unit 1 and up.
   */
  setUniforms?: (gl: WebGL2RenderingContext, program: WebGLProgram) => void;
  /**
   * Free whatever this pass uploaded — a cube, a mask map. Called when the
   * pass is REPLACED as well as when the graph goes, which only started
   * mattering once a graph outlived its pass list: before that the context was
   * torn down with every change and took every texture with it.
   */
  dispose?: (gl: WebGL2RenderingContext) => void;
  /**
   * Which rows of its input this pass reads to write a span of rows
   * (`band-plan.ts`) — what lets a big render be drawn in BANDS, with targets
   * a band tall instead of the whole frame. Absent where the pass has not
   * said: the graph then renders that chain whole, as it always has. A
   * colour pass is `OWN_ROWS`, a blur `nearRows(r)`, a warp `warpRows(map)`.
   */
  rows?: RowNeed | null;
}

/**
 * Frames at least this big are drawn in bands when every pass can say what it
 * reads: the stage (a phone's 3.7 MP, a computer's 8.3 MP 4K frame) never is,
 * so an interactive render stays one draw per pass; a full-density export is.
 */
const BAND_MIN_PIXELS = 12_000_000;
/** The rows of one band, as a share of pixels: ~4 MP of output per band. */
const BAND_PIXELS = 4_000_000;

let bandOverride: { min: number; pixels: number } | null = null;

/**
 * Force the banding threshold and the band's size — for the render gate and a
 * diagnostic, which must be able to band a small frame and compare it with the
 * whole. `null` restores the defaults.
 */
export function setBandingForTest(next: { min: number; pixels: number } | null): void {
  bandOverride = next;
}

let bandsLastDrawn = 1;

/** How many bands the last render of any graph was drawn in — 1 for a whole one. For the gate. */
export function bandsLastDrawnForTest(): number {
  return bandsLastDrawn;
}

/** The rows of one band for this frame, or null where it is drawn whole. */
export function bandRowsFor(width: number, height: number): number | null {
  const min = bandOverride?.min ?? BAND_MIN_PIXELS;
  const per = bandOverride?.pixels ?? BAND_PIXELS;
  if (width * height < min) return null;
  const rows = Math.max(16, Math.round(per / Math.max(1, width)));
  return rows < height ? rows : null;
}

export interface RenderGraph {
  /** What the intermediate buffers really are on this machine. */
  readonly precision: RenderPrecision;
  /**
   * The longest edge, in pixels, this GPU can take as a source or draw into —
   * the smaller of its texture, renderbuffer and viewport limits. A picture
   * past it does not fail loudly: the upload is refused with an error nobody
   * reads and the texture samples BLACK. `render-size.ts` fits a picture to
   * it; a caller that hands one over anyway is told once, in the console.
   */
  readonly maxSize: number;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /**
   * Draw `source` through `passes` onto the canvas, which is returned so a
   * caller can composite it. An empty list draws the source untouched. A
   * `HalfImage` (a decoded RAW) is uploaded at half-float precision and, like
   * a bitmap, once per identity.
   */
  render(source: RenderSource, passes: readonly RenderPass[]): HTMLCanvasElement | OffscreenCanvas;
  resize(width: number, height: number): void;
  /** Run a pass's own `dispose` against this graph's context. */
  releasePass(pass: RenderPass): void;
  dispose(): void;
}

const PASSTHROUGH: RenderPass = {
  id: 'passthrough',
  rows: OWN_ROWS,
  fragment: `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
void main() { outColor = texture(u_src, v_uv); }`,
};

/** The passthrough pass, exported so a caller can prove a round trip changes nothing. */
export const passthroughPass = PASSTHROUGH;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // Loudly, because nothing in CI can see a shader: a silent failure here
    // degrades to an un-graded picture with every gate green
    // (`media-pipeline.md`). `scripts/check-shader.mjs` is the real remedy.
    console.error(`[render] ${gl.getShaderInfoLog(shader) ?? 'shader would not compile'}`);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Compile and link a fragment shader against the graph's own vertex shader,
 * exported so a pass rendering into buffers of its own (`RenderPass.prepare`)
 * builds its programs through the SAME path — the `bindAttribLocation` trap
 * below is silent and would have to be re-learnt otherwise.
 */
export function linkPassProgram(
  gl: WebGL2RenderingContext,
  fragment: string,
): WebGLProgram | null {
  return linkProgram(gl, fragment);
}

function linkProgram(gl: WebGL2RenderingContext, fragment: string): WebGLProgram | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  if (!vert || !frag) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  // BEFORE linking, and it is load-bearing: the graph sets its quad up once, on
  // one VAO, against attribute location 0 — but GLSL is free to put `a_pos`
  // anywhere unless told, and where it chose another slot the quad drew
  // NOTHING. A black canvas, no error, every gate green. Measured: the core's
  // first run differed from `lut-gl.ts` by a full 255 codes.
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[render] ${gl.getProgramInfoLog(program) ?? 'program would not link'}`);
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
}

/** A source's pixel size, for the kinds that say it; null for the rest. */
function sourceSize(source: RenderSource): { width: number; height: number } | null {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  const { width, height } = source as { width?: unknown; height?: unknown };
  return typeof width === 'number' && typeof height === 'number' ? { width, height } : null;
}

/**
 * Build the core over a canvas, or null where WebGL2 is absent — the same
 * degradation `createLutRenderer` chose: a picture drawn un-processed beats a
 * page that will not render.
 */
export function createRenderGraph(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): RenderGraph | null {
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;

  // Rendering INTO a half-float buffer is an extension even in WebGL2; reading
  // and filtering one is not. Without it the chain runs at 8 bits and every
  // pass clamps, which is correct but has no headroom — so it is reported
  // rather than assumed.
  const canFloat = Boolean(
    gl.getExtension('EXT_color_buffer_half_float') ?? gl.getExtension('EXT_color_buffer_float'),
  );
  const precision: RenderPrecision = canFloat ? 'float16' : 'byte';
  const internalFormat = canFloat ? gl.RGBA16F : gl.RGBA8;
  const texType = canFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  // The cap on ONE edge. The source texture and the ping-pong targets are
  // textures (MAX_TEXTURE_SIZE), the canvas's drawing buffer a renderbuffer,
  // and the viewport has its own pair — the smallest of them is the honest
  // number, and a driver that answers nothing sensible gets a floor every
  // WebGL2 implementation must reach (2048).
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
  const limits = [
    gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    viewport?.[0],
    viewport?.[1],
  ].filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  const maxSize = limits.length ? Math.min(...limits) : 2048;
  let sizeSaid = false;
  const tooBig = (what: string, width: number, height: number) => {
    if (sizeSaid) return;
    sizeSaid = true;
    console.error(
      `[render] ${what} is ${width}×${height}, past the ${maxSize} px this GPU can take on one edge; ` +
        'the picture will be wrong — fit it with render-size.ts first',
    );
  };

  const quad = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const sourceTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sourceTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const programs = new Map<string, WebGLProgram | null>();
  const targets: (Target | null)[] = [null, null];
  let disposed = false;
  /**
   * The source the texture on unit 0 currently holds, when that is knowable.
   *
   * An `ImageBitmap` is IMMUTABLE — its pixels are fixed at creation — so the
   * same object rendered twice needs no second upload, and a pass swap (a mask
   * dragged, a keystone moved) costs the passes alone. Before this every
   * `render` re-uploaded the whole picture: tens of megabytes per slider step
   * for a stage-budget still, which `render-core.md` claimed was not happening.
   * A canvas or a video can change under the same identity, so those are
   * uploaded every time, as before.
   */
  let uploaded: ImageBitmap | HalfImage | null = null;
  /** Programs whose first draw has been checked for a GL error (dev only). */
  const checked = new Set<string>();
  let lostSaid = false;

  const targetAt = (index: 0 | 1, width: number, height: number): Target | null => {
    const held = targets[index];
    if (held && held.width === width && held.height === height) return held;
    if (held) {
      gl.deleteFramebuffer(held.fbo);
      gl.deleteTexture(held.tex);
    }
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, texType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // LINEAR, and it only started mattering with the second pass that RESAMPLES.
    // While every pass was 1:1 (the cube, a passthrough) each fragment read its
    // own texel centre and the filter could not be told apart; a lens warp
    // followed by a keystone reads BETWEEN texels, and NEAREST there is visible
    // stair-stepping on every edge in the picture. RGBA16F is texture-filterable
    // in core WebGL2 — it is RGBA32F that needs `OES_texture_float_linear`, the
    // distinction the cube upload already turns on.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const made: Target = { fbo, tex, width, height };
    targets[index] = made;
    return made;
  };

  /** Pass ids whose fragment could be made band-aware (`bandFragment`). */
  const bandable = new Set<string>();
  const programFor = (pass: RenderPass): WebGLProgram | null => {
    if (!programs.has(pass.id)) {
      // Every program is linked band-aware where it can be: at rest the map
      // is the identity to the bit, so a whole render is what it always was.
      const banded = bandFragment(pass.fragment);
      if (banded) bandable.add(pass.id);
      programs.set(pass.id, linkProgram(gl, banded ?? pass.fragment));
    }
    return programs.get(pass.id) ?? null;
  };

  /** The band plan for this chain at this size, or null to draw it whole. */
  const bandPlanFor = (list: readonly RenderPass[], width: number, height: number): BandPlan | null => {
    if (list.length < 2) return null;
    const rows = bandRowsFor(width, height);
    if (rows === null) return null;
    for (const pass of list) {
      if (!programFor(pass) || !bandable.has(pass.id)) return null;
    }
    return planBands({ width, height }, rows, list.map((pass) => pass.rows));
  };

  /**
   * One pass's draw: its program, its input on unit 0, the band it covers
   * (`u_band`) and where its input's rows sit in the texture it reads
   * (`u_srcBand`) — both zero for a whole render.
   */
  const drawPass = (
    pass: RenderPass,
    program: WebGLProgram,
    input: { texture: WebGLTexture | null; flipY: number; band: readonly [number, number, number, number] },
    output: { framebuffer: WebGLFramebuffer | null; y: number; scissor: RowSpan | null },
    width: number,
    height: number,
  ) => {
    // Before anything is bound for this pass's own draw: a pass that
    // renders into buffers of its own does it here, and the binding below
    // is what re-establishes the graph's state afterwards.
    pass.prepare?.(gl, { texture: input.texture, width, height, flipY: input.flipY });
    gl.bindVertexArray(vao);

    gl.useProgram(program);

    const uFlip = gl.getUniformLocation(program, 'u_flipY');
    if (uFlip) gl.uniform1f(uFlip, input.flipY);
    const uSrcBand = gl.getUniformLocation(program, 'u_srcBand');
    if (uSrcBand) gl.uniform4f(uSrcBand, input.band[0], input.band[1], input.band[2], input.band[3]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.texture);
    const uSrc = gl.getUniformLocation(program, 'u_src');
    if (uSrc) gl.uniform1i(uSrc, 0);
    const uTexel = gl.getUniformLocation(program, 'u_texel');
    if (uTexel) gl.uniform2f(uTexel, 1 / Math.max(1, width), 1 / Math.max(1, height));

    pass.setUniforms?.(gl, program);

    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    // The WHOLE frame's viewport, moved so the band's first row lands on the
    // target's first: every fragment then gets the very `v_uv` a whole render
    // gives it, to the last bit — a band drawn through a viewport of its own
    // interpolated coordinates a few ulps off, which was enough to flip a
    // pixel at a warp's empty edge from inside to outside. The scissor keeps
    // the work to the band.
    gl.viewport(0, output.y, width, height);
    if (output.scissor) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, output.scissor.y0, width, output.scissor.y1 - output.scissor.y0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (output.scissor) gl.disable(gl.SCISSOR_TEST);

    // The FIRST draw of each program is checked for a GL error, in
    // development only. Every trap `render-core.md` records — two sampler
    // types on one unit, an incomplete texture — is an INVALID_OPERATION
    // the driver reports here and nowhere else, and each was found by
    // hand. `getError` stalls the pipeline, so it is never per frame:
    // once per program, which is when a new pass could have got it wrong.
    if (import.meta.env.DEV && !checked.has(pass.id)) {
      checked.add(pass.id);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        console.error(`[render] pass "${pass.id}" left GL error 0x${error.toString(16)} on its first draw`);
      }
    }
  };

  return {
    precision,
    maxSize,
    canvas,

    resize(width, height) {
      if (width > maxSize || height > maxSize) tooBig('the render target', width, height);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    },

    releasePass(pass) {
      if (disposed) return;
      pass.dispose?.(gl);
    },

    render(source, passes) {
      if (disposed) return canvas;
      // A context the browser took back (memory pressure on a phone, a GPU
      // reset) accepts every call and draws nothing: without this the stage
      // would go black with no error anywhere. Said once, not per frame.
      if (gl.isContextLost()) {
        if (!lostSaid) {
          lostSaid = true;
          console.warn('[render] the WebGL context was lost; the picture is drawn unprocessed');
        }
        return canvas;
      }
      const list = passes.length ? passes : [PASSTHROUGH];
      const plan = planPasses(list.length);
      const width = canvas.width;
      const height = canvas.height;

      // The source, uploaded once for the whole chain — and, for a bitmap,
      // once for its LIFETIME on this graph.
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex);
      // `UNPACK_FLIP_Y_WEBGL` is IGNORED for an ImageBitmap, whose orientation
      // is fixed at creation — so a decoded photo arrives in image order while
      // a video or a canvas arrives flipped, and the vertex shader's `u_flipY`
      // compensates. The rule `lut-gl.ts` learnt the hard way; an FBO round
      // trip is neutral under one UV convention, so only the FIRST pass has to
      // care.
      const bitmap = typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap ? source : null;
      const half = isHalfImage(source) ? source : null;
      // Both are immutable, so both are keyed by identity and uploaded once.
      const keyed = bitmap ?? half;
      const bitmapSource = bitmap ? 1 : 0;
      if (!keyed || keyed !== uploaded) {
        const size = sourceSize(source);
        if (size && (size.width > maxSize || size.height > maxSize)) {
          tooBig('the source', size.width, size.height);
        }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        if (half) {
          // A typed array HONOURS the flip flag (only a bitmap ignores it), so
          // a top-row-first picture lands like a canvas does and `u_flipY`
          // stays 0. Three half-floats per texel are 6 bytes, so an odd width
          // makes a row that is not a multiple of the default alignment of 4.
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, half.width, half.height, 0, gl.RGB, gl.HALF_FLOAT, half.data);
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
        }
        uploaded = keyed;
      }

      const WHOLE_SRC = [0, 0, 0, 0] as const;
      const bands = bandPlanFor(list, width, height);
      bandsLastDrawn = bands ? bands.bands.length : 1;

      if (!bands) {
        const needed = targetsNeeded(list.length);
        for (let i = 0; i < needed; i += 1) {
          if (!targetAt(i as 0 | 1, width, height)) return canvas;
        }
        for (let i = 0; i < plan.length; i += 1) {
          const slot: PassSlot = plan[i];
          const pass = list[i];
          const program = programFor(pass);
          if (!program) continue;
          const fromTex = slot.from === 'source' ? sourceTex : (targets[slot.from]?.tex ?? null);
          drawPass(
            pass,
            program,
            { texture: fromTex, flipY: slot.from === 'source' ? bitmapSource : 0, band: WHOLE_SRC },
            { framebuffer: slot.to === 'canvas' ? null : (targets[slot.to]?.fbo ?? null), y: 0, scissor: null },
            width,
            height,
          );
        }
      } else {
        // BANDS: the targets are a band tall (plus what the passes after it
        // read around it), never the whole frame, and the canvas is written a
        // band at a time. The source stays whole — the first pass reads it.
        const needed = targetsNeeded(list.length);
        for (let i = 0; i < needed; i += 1) {
          if (!targetAt(i as 0 | 1, width, bands.targetRows)) return canvas;
        }
        const allocated = bands.targetRows / height;
        const edge = [0.5 / height, 1 - 0.5 / height] as const;
        for (const band of bands.bands) {
          for (let i = 0; i < plan.length; i += 1) {
            const slot: PassSlot = plan[i];
            const pass = list[i];
            const program = programFor(pass);
            if (!program) continue;
            const region: RowSpan = band.regions[i];
            const rows = region.y1 - region.y0;
            if (rows <= 0) continue;
            const readsSource = slot.from === 'source';
            const inRegion = readsSource ? null : band.regions[i - 1];
            drawPass(
              pass,
              program,
              {
                texture: readsSource ? sourceTex : (targets[slot.from as 0 | 1]?.tex ?? null),
                flipY: readsSource ? bitmapSource : 0,
                band: inRegion ? [inRegion.y0 / height, allocated - 1, edge[0], edge[1]] : WHOLE_SRC,
              },
              slot.to === 'canvas'
                ? { framebuffer: null, y: 0, scissor: region }
                : {
                    framebuffer: targets[slot.to]?.fbo ?? null,
                    // Frame row `region.y0` lands on the target's row 0.
                    y: -region.y0,
                    scissor: { y0: 0, y1: rows },
                  },
              width,
              height,
            );
          }
        }
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return canvas;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      uploaded = null;
      for (const program of programs.values()) if (program) gl.deleteProgram(program);
      programs.clear();
      for (const target of targets) {
        if (!target) continue;
        gl.deleteFramebuffer(target.fbo);
        gl.deleteTexture(target.tex);
      }
      gl.deleteTexture(sourceTex);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      // Deleting the objects frees their memory but NOT the context slot, which
      // is a page-lifetime cap — the leak that broke every export after a failed
      // one (`media-pipeline.md`).
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
