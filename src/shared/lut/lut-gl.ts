/**
 * WebGL2 renderer that grades a video frame through a 3D LUT in real time.
 *
 * The browser still decodes the video natively (HTML `<video>`); this just adds
 * a GPU pass on top: each frame is uploaded as a 2D texture, its colour is used
 * to look up the graded colour in a 3D LUT texture (`sampler3D`), and the
 * result is drawn to a `<canvas>`.
 *
 * The lookup itself lives in `shared/render/glsl.ts`, shared with the render
 * core's cube pass — two copies of it is exactly how a preview and an export
 * come to disagree.
 *
 * Two lookups live in that chunk. TRILINEAR is one `texture()` call — the
 * hardware sampler does the work for free. TETRAHEDRAL fetches the cell's 8
 * corners with `texelFetch` and interpolates from the 4 that matter; it is
 * what Resolve uses, and it keeps neutrals neutral (see interpolate.ts, which
 * holds the same maths for the CPU bake — the two MUST agree or preview and
 * export diverge). `texelFetch` ignores sampler filter state, so both paths
 * share one texture and the mode is a live uniform switch: no re-upload. The
 * cube's texels are uploaded by `render/cube-pass.ts`, float or half-float —
 * one upload for both shaders, as the lookup is one chunk.
 *
 * Kept framework-free (no React, no DOM tree beyond the canvas it's handed) so
 * the GPU logic lives in one testable-by-inspection place; the React glue is in
 * `src/hooks/use-lut-preview.ts`.
 */

import type { CubeLut } from '../lib/cube-parser';
import type { Interpolation } from './interpolate';
import { GLSL_VERSION, LUT_LOOKUP, LUT_UNIFORMS, VERTEX_SRC } from '../render/glsl';
import { uploadCube } from '../render/cube-pass';

const VERT_SRC = VERTEX_SRC;

const FRAG_SRC = `${GLSL_VERSION}
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_video;
uniform bool u_split;    // before/after wipe active
uniform float u_splitX;  // wipe position in [0,1]; left of it shows the grade
${LUT_UNIFORMS}
${LUT_LOOKUP}

void main() {
  vec4 src = texture(u_video, v_uv);
  vec3 graded = gradeThroughLut(src.rgb);
  // In split mode, reveal the original to the right of the divider.
  vec3 rgb = (u_split && v_uv.x > u_splitX) ? src.rgb : graded;
  outColor = vec4(rgb, src.a);
}`;

/**
 * The lattice lookup every NEW renderer starts with.
 *
 * Interpolation is a global RENDER preference, not per-project creative data,
 * and the export paths build a throwaway renderer per job through
 * `frame-grader.ts` — threading a mode through eight call sites (several of
 * them already eight positional arguments deep) would buy nothing. Long-lived
 * preview renderers take the mode explicitly instead, via `setInterpolation`,
 * because they have to change it live.
 *
 * Defaults to 'tetrahedral', matching Resolve, Nuke and Baselight — and
 * matching `useLutInterpolation`'s own default, so the app renders the same
 * way whichever tool the user opens first. Before this path existed everything
 * was trilinear; the preference can put it back.
 */
let defaultInterpolation: Interpolation = 'tetrahedral';

/**
 * The mode a new renderer starts with. Read by the render core, which builds
 * its cube pass from the same preference — a grader that hardcoded
 * 'tetrahedral' would quietly ignore someone who had chosen trilinear.
 */
export function getDefaultLutInterpolation(): Interpolation {
  return defaultInterpolation;
}

/** Set the mode new renderers start with. Owned by `useLutInterpolation`. */
export function setDefaultLutInterpolation(mode: Interpolation): void {
  defaultInterpolation = mode;
}

export interface LutRenderer {
  /** Replace the active LUT, or pass null to render the video ungraded. */
  setLut(lut: CubeLut | null): void;
  /** Enable a before/after wipe; `x` (0..1) is the divider, graded on its left. */
  setSplit(active: boolean, x: number): void;
  /** LUT strength: 0 = original, 1 = full LUT, up to 3 = over-applied. */
  setIntensity(value: number): void;
  /** Switch the lattice lookup. Live: no re-upload, no texture state change. */
  setInterpolation(mode: Interpolation): void;
  /** Upload the given frame source and draw (graded if a LUT is set). */
  draw(source: TexImageSource): void;
  /** Resize the drawing buffer to match the source resolution. */
  resize(width: number, height: number): void;
  /** Release all GL resources. */
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('LUT shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Create a renderer for the given canvas, or return null if WebGL2 is
 * unavailable (caller should fall back to a plain message). Accepts an
 * `OffscreenCanvas` too, so the same code grades the live preview and the
 * frame-by-frame export pass.
 */
export function createLutRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): LutRenderer | null {
  // `preserveDrawingBuffer` lets the export read each rendered frame back into
  // a VideoFrame after drawing; harmless for the live preview.
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;

  const vert = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vert || !frag) return null;

  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('LUT program link failed:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  // Full-screen quad (two triangles via a strip).
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const posLoc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uVideo = gl.getUniformLocation(program, 'u_video');
  const uLut = gl.getUniformLocation(program, 'u_lut');
  const uHasLut = gl.getUniformLocation(program, 'u_hasLut');
  const uLutSize = gl.getUniformLocation(program, 'u_lutSize');
  const uSplit = gl.getUniformLocation(program, 'u_split');
  const uSplitX = gl.getUniformLocation(program, 'u_splitX');
  const uIntensity = gl.getUniformLocation(program, 'u_intensity');
  const uTetra = gl.getUniformLocation(program, 'u_tetra');
  const uDomainMin = gl.getUniformLocation(program, 'u_domainMin');
  const uDomainMax = gl.getUniformLocation(program, 'u_domainMax');
  const uFlipY = gl.getUniformLocation(program, 'u_flipY');
  gl.uniform1i(uVideo, 0); // video on texture unit 0
  gl.uniform1i(uLut, 1); // LUT on texture unit 1
  gl.uniform1f(uSplitX, 0.5);
  gl.uniform1f(uIntensity, 1.0); // full-strength LUT until told otherwise
  gl.uniform1i(uTetra, defaultInterpolation === 'tetrahedral' ? 1 : 0);
  gl.uniform3f(uDomainMin, 0, 0, 0); // the default cube domain is [0,1]
  gl.uniform3f(uDomainMax, 1, 1, 1);

  // Video frame texture (unit 0). Frames are uploaded flipped so UVs line up.
  const videoTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let lutTex: WebGLTexture | null = null;
  let lutSize = 0;
  let hasLut = false;

  function uploadLut(lut: CubeLut) {
    if (!lutTex) lutTex = gl!.createTexture();
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_3D, lutTex);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_R, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.pixelStorei(gl!.UNPACK_ALIGNMENT, 1);
    // texImage3D errors if FLIP_Y is left on from a video upload; clear it.
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);

    // The texels themselves are ONE upload shared with the render core's cube
    // pass: float where the GPU can filter it, half-float elsewhere, never
    // 8-bit (`cube-pass.ts`).
    uploadCube(gl!, lut);

    lutSize = lut.size;
    hasLut = true;
    gl!.useProgram(program);
    gl!.uniform1f(uLutSize, lutSize);
    gl!.uniform1i(uHasLut, 1);
    // The cube's own input domain: `sampleLut` honours it, so the shader must
    // too or preview and bake disagree.
    gl!.uniform3f(uDomainMin, lut.domainMin[0], lut.domainMin[1], lut.domainMin[2]);
    gl!.uniform3f(uDomainMax, lut.domainMax[0], lut.domainMax[1], lut.domainMax[2]);
  }

  return {
    setLut(lut) {
      if (lut) {
        uploadLut(lut);
      } else {
        hasLut = false;
        gl.useProgram(program);
        gl.uniform1i(uHasLut, 0);
      }
    },

    setSplit(active, x) {
      gl.useProgram(program);
      gl.uniform1i(uSplit, active ? 1 : 0);
      gl.uniform1f(uSplitX, x);
    },

    setIntensity(value) {
      gl.useProgram(program);
      gl.uniform1f(uIntensity, value);
    },

    setInterpolation(mode) {
      gl.useProgram(program);
      gl.uniform1i(uTetra, mode === 'tetrahedral' ? 1 : 0);
    },

    draw(source) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      // The flag above is IGNORED for an ImageBitmap — its orientation is
      // fixed at creation, per the WebGL spec — so a decoded photo uploads in
      // image order while every other source arrives flipped. Compensate in
      // the vertex shader, or a graded still renders upside down (measured:
      // the Studio's photo stage and its JPEG export, LUT on).
      gl.uniform1f(
        uFlipY,
        typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap ? 1 : 0,
      );
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      if (hasLut && lutTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, lutTex);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    resize(width, height) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    },

    dispose() {
      gl.deleteTexture(videoTex);
      if (lutTex) gl.deleteTexture(lutTex);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      // Deleting the GL objects above frees their GPU memory but NOT the
      // context itself — that only happens on GC (non-deterministic) or a
      // browser-forced loss once the page's context cap is hit. An export
      // creates one of these per run (frame-grader.ts), so without an
      // explicit loseContext() a run of exports silently eats into that cap
      // until new contexts stop being grantable — surfacing as an unrelated
      // "LUT stopped applying" or a broken preview later in the same tab.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
