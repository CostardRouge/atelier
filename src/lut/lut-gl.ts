/**
 * WebGL2 renderer that grades a video frame through a 3D LUT in real time.
 *
 * The browser still decodes the video natively (HTML `<video>`); this just adds
 * a GPU pass on top: each frame is uploaded as a 2D texture, its colour is used
 * to look up the graded colour in a 3D LUT texture (`sampler3D`, hardware
 * trilinear interpolation), and the result is drawn to a `<canvas>`.
 *
 * Kept framework-free (no React, no DOM tree beyond the canvas it's handed) so
 * the GPU logic lives in one testable-by-inspection place; the React glue is in
 * `src/hooks/use-lut-preview.ts`.
 */

import type { CubeLut } from '../lib/cube-parser';

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // a_pos spans the [-1,1] clip-space quad; derive [0,1] UVs from it.
  v_uv = a_pos * 0.5 + 0.5;
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

void main() {
  vec4 src = texture(u_video, v_uv);
  if (u_hasLut) {
    // Map [0,1] onto the texel centres so the edges of the cube aren't clipped:
    // scale = (N-1)/N, offset = 0.5/N.
    float scale = (u_lutSize - 1.0) / u_lutSize;
    float offset = 0.5 / u_lutSize;
    vec3 coord = clamp(src.rgb, 0.0, 1.0) * scale + offset;
    outColor = vec4(texture(u_lut, coord).rgb, src.a);
  } else {
    outColor = src;
  }
}`;

export interface LutRenderer {
  /** Replace the active LUT, or pass null to render the video ungraded. */
  setLut(lut: CubeLut | null): void;
  /** Upload the current video frame and draw (graded if a LUT is set). */
  draw(video: HTMLVideoElement): void;
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
 * unavailable (caller should fall back to a plain message).
 */
export function createLutRenderer(canvas: HTMLCanvasElement): LutRenderer | null {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false });
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
  gl.uniform1i(uVideo, 0); // video on texture unit 0
  gl.uniform1i(uLut, 1); // LUT on texture unit 1

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

    draw(video) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

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
    },
  };
}
