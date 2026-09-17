/**
 * The GLSL every pass shares — ONE source for each formula.
 *
 * `lut-gl.ts` and the render core's cube node both grade through a 3D LUT, and
 * two copies of that lookup is precisely how a preview and an export come to
 * disagree (`media-pipeline.md` already says the GLSL and `interpolate.ts` MUST
 * agree; a third implementation would be a third thing to keep in step). So the
 * lookup lives here as a string, included by both, and
 * `scripts/check-shader.mjs` compiles it against the pure module.
 *
 * Not a shader on its own: a chunk. A pass assembles `GLSL_VERSION`, its own
 * uniforms, the chunks it needs and a `main`.
 */

export const GLSL_VERSION = '#version 300 es';

/** The full-screen quad's vertex shader. `u_flipY` is the ImageBitmap rule. */
export const VERTEX_SRC = `${GLSL_VERSION}
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

/**
 * The uniforms a LUT lookup reads. Declared apart from the functions so a pass
 * can put its own uniforms beside them without a name clash.
 */
export const LUT_UNIFORMS = `
uniform sampler3D u_lut;
uniform bool u_hasLut;
uniform float u_lutSize;
uniform bool u_tetra;    // tetrahedral lookup instead of hardware trilinear
uniform float u_intensity; // LUT strength: 0 = original, 1 = full, >1 over-applied
uniform vec3 u_domainMin;  // the cube's DOMAIN_MIN, (0,0,0) unless declared
uniform vec3 u_domainMax;  // the cube's DOMAIN_MAX, (1,1,1) unless declared
`;

/**
 * The lattice lookup, both paths. Lifted verbatim from `lut-gl.ts` when the
 * render core needed the same formula — the comments are load-bearing and are
 * kept with the code they explain.
 */
export const LUT_LOOKUP = `
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

/** The graded colour: the look, mixed toward by intensity. */
vec3 gradeThroughLut(vec3 rgb) {
  if (!u_hasLut) return rgb;
  vec3 looked;
  if (u_tetra) {
    looked = lookupTetrahedral(rgb);
  } else {
    // Map the domain-normalized value onto the texel centres so the edges
    // of the cube aren't clipped: scale = (N-1)/N, offset = 0.5/N. The
    // domain step composes BEFORE this one — swapping them is the one way
    // to get this subtly wrong.
    float scale = (u_lutSize - 1.0) / u_lutSize;
    float offset = 0.5 / u_lutSize;
    vec3 coord = normalizeDomain(rgb) * scale + offset;
    looked = texture(u_lut, coord).rgb;
  }
  // Blend toward the look. >1 extrapolates past it (stronger than the LUT
  // itself); an 8-bit target clamps any overshoot on write, a float16 one
  // keeps it for a later pass.
  return mix(rgb, looked, u_intensity);
}
`;
