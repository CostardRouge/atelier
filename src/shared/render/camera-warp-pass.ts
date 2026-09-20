/**
 * The camera's own WarpRectilinear as ONE pass — the lens pass's shape, with
 * the file's coefficients instead of a person's sliders.
 *
 * Three planes are sampled at three positions of one radius, exactly as the
 * lens pass samples three scales of one: that is what takes the coloured
 * fringe off a corner, and on a DJI it is the whole of the difference between
 * the planes. Green is the reference and decides whether a pixel exists at
 * all; a channel whose own map took it off the picture keeps green's, rather
 * than going black and painting a coloured edge of its own — the lens pass's
 * rule, for the lens pass's reason.
 *
 * Unlike the lens pass this one is NOT radial about the frame's centre: the
 * optical centre is the file's, and may be anywhere. So it asks WHERE a pixel
 * is and converts with `imageUv` (`render-geometry.md`'s rule) — and
 * `check-render.mjs` runs it from a canvas AND an `ImageBitmap`, which is what
 * proves that conversion right.
 *
 * The maths is `camera-warp.ts`, including the one convention that is an
 * assumption (what the radius is normalised by).
 */

import { GLSL_VERSION, IMAGE_UV } from './glsl';
import { planeOf, warpNormRadius, type CameraWarp } from './camera-warp';
import { isIdentityWarp } from '../exif/dng-opcodes';
import type { RenderPass } from './graph';

const FRAGMENT = `${GLSL_VERSION}
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_src;
uniform vec2 u_center;        // the OPTICAL centre, in image [0,1]
uniform vec2 u_span;          // (width, height) / the normalising radius
uniform vec4 u_radial[3];     // k0..k3 per plane: red, green, blue
uniform vec2 u_tangential[3];
${IMAGE_UV}

// Mirrors warpSourcePoint() in camera-warp.ts — the two MUST agree, and
// check-render.mjs is what proves it.
vec2 sourcePoint(vec2 n, vec4 k, vec2 t) {
  float r2 = dot(n, n);
  float ratio = k.x + k.y * r2 + k.z * r2 * r2 + k.w * r2 * r2 * r2;
  return vec2(
    ratio * n.x + t.x * (r2 + 2.0 * n.x * n.x) + 2.0 * t.y * n.x * n.y,
    ratio * n.y + t.y * (r2 + 2.0 * n.y * n.y) + 2.0 * t.x * n.x * n.y
  );
}

// An image point for one plane, back in the texture's own coordinates.
vec2 sampleUv(vec2 n, int plane) {
  vec2 s = sourcePoint(n, u_radial[plane], u_tangential[plane]);
  return imageUv(u_center + s / u_span);
}

bool outside(vec2 uv) {
  return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

void main() {
  vec2 img = imageUv(v_uv);
  vec2 n = (img - u_center) * u_span;

  vec2 uvG = sampleUv(n, 1);
  // Outside the picture is EMPTY, never the edge pixel smeared outwards — the
  // refusal the lens and the keystone both make.
  if (outside(uvG)) { outColor = vec4(0.0); return; }
  vec4 green = texture(u_src, uvG);

  vec2 uvR = sampleUv(n, 0);
  vec2 uvB = sampleUv(n, 2);
  vec3 rgb = green.rgb;
  rgb.r = outside(uvR) ? green.r : texture(u_src, uvR).r;
  rgb.b = outside(uvB) ? green.b : texture(u_src, uvB).b;
  outColor = vec4(rgb, green.a);
}`;

/**
 * A camera-warp pass, or null when the file's own numbers move no pixel — a
 * caller then runs one fewer pass rather than a no-op resample, which is a
 * whole round trip of interpolation for no change at all.
 *
 * `width`/`height` are the pixels the opcode was written against: the radius
 * it normalises by is a distance in those.
 */
export function makeCameraWarpPass(
  warp: CameraWarp | null | undefined,
  width: number,
  height: number,
): RenderPass | null {
  if (!warp || isIdentityWarp(warp) || !(width > 0) || !(height > 0)) return null;
  const radius = warpNormRadius(warp, width, height);
  const radial = new Float32Array(12);
  const tangential = new Float32Array(6);
  for (let p = 0; p < 3; p += 1) {
    const plane = planeOf(warp, p);
    radial.set(plane.radial, p * 4);
    tangential.set(plane.tangential, p * 2);
  }
  return {
    id: 'camera-warp',
    fragment: FRAGMENT,
    setUniforms(gl, program) {
      const at = (name: string) => gl.getUniformLocation(program, name);
      gl.uniform2f(at('u_center'), warp.centerH, warp.centerV);
      gl.uniform2f(at('u_span'), width / radius, height / radius);
      gl.uniform4fv(at('u_radial[0]'), radial);
      gl.uniform2fv(at('u_tangential[0]'), tangential);
    },
  };
}
