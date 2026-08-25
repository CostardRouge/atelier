/**
 * WebGL2 renderer that grades a video frame through a 3D LUT in real time.
 *
 * The browser still decodes the video natively (HTML `<video>`); this just adds
 * a GPU pass on top: each frame is uploaded as a 2D texture, its colour is used
 * to look up the graded colour in a 3D LUT texture (`sampler3D`), and the
 * result is drawn to a `<canvas>`.
 *
 * Two lookups live in the shader. TRILINEAR is one `texture()` call — the
 * hardware sampler does the work for free. TETRAHEDRAL fetches the cell's 8
 * corners with `texelFetch` and interpolates from the 4 that matter; it is
 * what Resolve uses, and it keeps neutrals neutral (see interpolate.ts, which
 * holds the same maths for the CPU bake — the two MUST agree or preview and
 * export diverge). `texelFetch` ignores sampler filter state, so both paths
 * share one texture and the mode is a live uniform switch: no re-upload, and
 * the 8-bit fallback for GPUs without `OES_texture_float_linear` is untouched.
 *
 * Kept framework-free (no React, no DOM tree beyond the canvas it's handed) so
 * the GPU logic lives in one testable-by-inspection place; the React glue is in
 * `src/hooks/use-lut-preview.ts`.
 */

import type { CubeLut } from '../lib/cube-parser';
import type { Interpolation } from './interpolate';

const VERT_SRC = `#version 300 es
in vec2 a_pos;
// 1.0 when the source texture was uploaded in image order (an ImageBitmap,
// whose orientation is fixed at creation — UNPACK_FLIP_Y_WEBGL is IGNORED
// for it per spec), 0.0 for sources the flag really flips (video, canvas).
uniform float u_flipY;
out vec2 v_uv;
void main() {
  // a_pos spans the [-1,1] clip-space quad; derive [0,1] UVs from it.
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = mix(v_uv.y, 1.0 - v_uv.y, u_flipY);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_video;
uniform sampler3D u_lut;
uniform bool u_hasLut;
uniform float u_lutSize;
uniform bool u_tetra;    // tetrahedral lookup instead of hardware trilinear
uniform bool u_split;    // before/after wipe active
uniform float u_splitX;  // wipe position in [0,1]; left of it shows the grade
uniform float u_intensity; // LUT strength: 0 = original, 1 = full, >1 over-applied
uniform vec3 u_domainMin;  // the cube's DOMAIN_MIN, (0,0,0) unless declared
uniform vec3 u_domainMax;  // the cube's DOMAIN_MAX, (1,1,1) unless declared

/**
 * Map a colour onto the cube's declared input domain, exactly as
 * latticeCoords does in interpolate.ts — including its span==0 gives 0 rule.
 * Most cubes declare [0,1], for which this reduces to clamp(rgb, 0, 1) and
 * every render is unchanged; a cube with DOMAIN_MIN/DOMAIN_MAX would
 * otherwise be sampled here on the wrong axis while the CPU bake got it
 * right, so the same LUT rendered one way at full strength and another the
 * moment a slider moved.
 */
vec3 normalizeDomain(vec3 rgb) {
  vec3 span = u_domainMax - u_domainMin;
  // NB: not named 'flat' — that is a reserved interpolation qualifier in
  // GLSL ES 3.00 and the shader will not compile.
  bvec3 degenerate = equal(span, vec3(0.0));
  // Guard the divide BEFORE it happens: a zero span gives inf, and mix() with
  // a bvec selects rather than blends, so an inf would survive the select.
  vec3 safeSpan = mix(span, vec3(1.0), degenerate);
  return mix(clamp((rgb - u_domainMin) / safeSpan, 0.0, 1.0), vec3(0.0), degenerate);
}

/** One lattice point, with the index clamped like CLAMP_TO_EDGE. */
vec3 lutTexel(ivec3 c, int last) {
  return texelFetch(u_lut, clamp(c, ivec3(0), ivec3(last)), 0).rgb;
}

/**
 * Tetrahedral (Kasson): order the fractions to pick one of 6 tetrahedra, then
 * interpolate from its 4 vertices. All six share the c000->c111 edge — the
 * neutral axis — so a grey interpolates between two greys and stays grey.
 */
vec3 lookupTetrahedral(vec3 rgb) {
  int last = int(u_lutSize) - 1;
  vec3 p = normalizeDomain(rgb) * float(last);
  vec3 base = floor(p);
  vec3 f = p - base;
  ivec3 i0 = ivec3(base);

  vec3 c000 = lutTexel(i0 + ivec3(0, 0, 0), last);
  vec3 c100 = lutTexel(i0 + ivec3(1, 0, 0), last);
  vec3 c010 = lutTexel(i0 + ivec3(0, 1, 0), last);
  vec3 c110 = lutTexel(i0 + ivec3(1, 1, 0), last);
  vec3 c001 = lutTexel(i0 + ivec3(0, 0, 1), last);
  vec3 c101 = lutTexel(i0 + ivec3(1, 0, 1), last);
  vec3 c011 = lutTexel(i0 + ivec3(0, 1, 1), last);
  vec3 c111 = lutTexel(i0 + ivec3(1, 1, 1), last);

  if (f.r > f.g) {
    if (f.g > f.b) {
      return c000 + (c100 - c000) * f.r + (c110 - c100) * f.g + (c111 - c110) * f.b;
    } else if (f.r > f.b) {
      return c000 + (c100 - c000) * f.r + (c111 - c101) * f.g + (c101 - c100) * f.b;
    }
    return c000 + (c101 - c001) * f.r + (c111 - c101) * f.g + (c001 - c000) * f.b;
  }
  if (f.b > f.g) {
    return c000 + (c111 - c011) * f.r + (c011 - c001) * f.g + (c001 - c000) * f.b;
  } else if (f.b > f.r) {
    return c000 + (c111 - c011) * f.r + (c010 - c000) * f.g + (c011 - c010) * f.b;
  }
  return c000 + (c110 - c010) * f.r + (c010 - c000) * f.g + (c111 - c110) * f.b;
}

void main() {
  vec4 src = texture(u_video, v_uv);
  vec3 graded = src.rgb;
  if (u_hasLut) {
    vec3 looked;
    if (u_tetra) {
      looked = lookupTetrahedral(src.rgb);
    } else {
      // Map the domain-normalized value onto the texel centres so the edges
      // of the cube aren't clipped: scale = (N-1)/N, offset = 0.5/N. The
      // domain step composes BEFORE this one — swapping them is the one way
      // to get this subtly wrong.
      float scale = (u_lutSize - 1.0) / u_lutSize;
      float offset = 0.5 / u_lutSize;
      vec3 coord = normalizeDomain(src.rgb) * scale + offset;
      looked = texture(u_lut, coord).rgb;
    }
    // Blend toward the look. >1 extrapolates past it (stronger than the LUT
    // itself); the 8-bit canvas clamps any overshoot on write.
    graded = mix(src.rgb, looked, u_intensity);
  }
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

  // Prefer float precision for the LUT if the GPU can filter it linearly,
  // otherwise fall back to 8-bit (always filterable). 8-bit is plenty for a
  // preview; the difference is only visible on extreme grades.
  const floatLinear = gl.getExtension('OES_texture_float_linear');

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

    const n = lut.size;
    const texels = n * n * n;
    // The source is RGB; expand to RGBA (alpha = 1) for predictable alignment.
    if (floatLinear) {
      const rgba = new Float32Array(texels * 4);
      for (let i = 0; i < texels; i++) {
        rgba[i * 4] = lut.data[i * 3];
        rgba[i * 4 + 1] = lut.data[i * 3 + 1];
        rgba[i * 4 + 2] = lut.data[i * 3 + 2];
        rgba[i * 4 + 3] = 1;
      }
      gl!.texImage3D(gl!.TEXTURE_3D, 0, gl!.RGBA32F, n, n, n, 0, gl!.RGBA, gl!.FLOAT, rgba);
    } else {
      const rgba = new Uint8Array(texels * 4);
      for (let i = 0; i < texels; i++) {
        rgba[i * 4] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3])) * 255);
        rgba[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 1])) * 255);
        rgba[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, lut.data[i * 3 + 2])) * 255);
        rgba[i * 4 + 3] = 255;
      }
      gl!.texImage3D(gl!.TEXTURE_3D, 0, gl!.RGBA8, n, n, n, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, rgba);
    }

    lutSize = n;
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
