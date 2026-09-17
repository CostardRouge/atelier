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

import { VERTEX_SRC } from './glsl';
import { planPasses, targetsNeeded, type PassSlot } from './pass-plan';

/** What the intermediate buffers can hold. */
export type RenderPrecision = 'float16' | 'byte';

export interface RenderPass {
  /** For a message when a pass will not compile. */
  id: string;
  /** The whole fragment shader. It reads `v_uv` and `u_src`, and writes `outColor`. */
  fragment: string;
  /**
   * Bind anything beyond `u_src`. Called with the program already in use and
   * texture unit 0 taken by the input; a pass uses unit 1 and up.
   */
  setUniforms?: (gl: WebGL2RenderingContext, program: WebGLProgram) => void;
}

export interface RenderGraph {
  /** What the intermediate buffers really are on this machine. */
  readonly precision: RenderPrecision;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /**
   * Draw `source` through `passes` onto the canvas, which is returned so a
   * caller can composite it. An empty list draws the source untouched.
   */
  render(source: TexImageSource, passes: readonly RenderPass[]): HTMLCanvasElement | OffscreenCanvas;
  resize(width: number, height: number): void;
  dispose(): void;
}

const PASSTHROUGH: RenderPass = {
  id: 'passthrough',
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const made: Target = { fbo, tex, width, height };
    targets[index] = made;
    return made;
  };

  const programFor = (pass: RenderPass): WebGLProgram | null => {
    if (!programs.has(pass.id)) programs.set(pass.id, linkProgram(gl, pass.fragment));
    return programs.get(pass.id) ?? null;
  };

  return {
    precision,
    canvas,

    resize(width, height) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    },

    render(source, passes) {
      if (disposed) return canvas;
      const list = passes.length ? passes : [PASSTHROUGH];
      const plan = planPasses(list.length);
      const width = canvas.width;
      const height = canvas.height;

      // The source, uploaded once for the whole chain.
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      // IGNORED for an ImageBitmap, whose orientation is fixed at creation —
      // so a decoded photo arrives in image order while a video or a canvas
      // arrives flipped, and the vertex shader's `u_flipY` compensates. The
      // rule `lut-gl.ts` learnt the hard way; an FBO round trip is neutral
      // under one UV convention, so only the FIRST pass has to care.
      const bitmapSource =
        typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap ? 1 : 0;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      const needed = targetsNeeded(list.length);
      for (let i = 0; i < needed; i += 1) {
        if (!targetAt(i as 0 | 1, width, height)) return canvas;
      }

      for (let i = 0; i < plan.length; i += 1) {
        const slot: PassSlot = plan[i];
        const pass = list[i];
        const program = programFor(pass);
        if (!program) continue;
        gl.useProgram(program);

        const uFlip = gl.getUniformLocation(program, 'u_flipY');
        if (uFlip) gl.uniform1f(uFlip, slot.from === 'source' ? bitmapSource : 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(
          gl.TEXTURE_2D,
          slot.from === 'source' ? sourceTex : (targets[slot.from]?.tex ?? null),
        );
        const uSrc = gl.getUniformLocation(program, 'u_src');
        if (uSrc) gl.uniform1i(uSrc, 0);
        const uTexel = gl.getUniformLocation(program, 'u_texel');
        if (uTexel) gl.uniform2f(uTexel, 1 / Math.max(1, width), 1 / Math.max(1, height));

        pass.setUniforms?.(gl, program);

        gl.bindFramebuffer(
          gl.FRAMEBUFFER,
          slot.to === 'canvas' ? null : (targets[slot.to]?.fbo ?? null),
        );
        gl.viewport(0, 0, width, height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return canvas;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
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
