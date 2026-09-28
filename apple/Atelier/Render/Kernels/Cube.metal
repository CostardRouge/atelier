// The colour cube — the LOOK, and the develop with it, as ONE pass of the
// graph: the web's `src/shared/render/cube-pass.ts` over the lookup in
// `src/shared/render/glsl.ts` (`LUT_LOOKUP`), transcribed term for term. The
// pure twins the gate holds this kernel to are `sampleTetrahedral` and
// `sampleTrilinear` in the kernel's `CubeLut.swift`
// (`apple/AtelierTests/Render/CubePassTests.swift`).
//
// The N³ lattice arrives PACKED into a 2D half-float image: N tiles of N×N
// laid along x — the tile is the blue index, x within the tile the red, y the
// green (`CubePass.pack`) — through a NEAREST sampler. It has to be a general
// kernel: the lattice is read at computed coordinates, which a colour kernel
// cannot do. A point is read at its pixel centre in the lattice's own
// working-space coordinates and handed to the sampler through `transform`,
// never as-is: a sampler's `sample` takes SAMPLER space, which is not pixels.
//
// TETRAHEDRAL, as the web's default: all six tetrahedra share the c000→c111
// edge — the neutral axis — so a grey interpolates between two greys and
// NEUTRALS STAY NEUTRAL exactly, where trilinear (and the retired
// `CIColorCubeWithColorSpace`) mixes in the two far corners and tints them.
// Trilinear stays on request, computed from the same eight exact corners.
//
// Metal, compiled at build time under `-fcikernel` / `-cikernel`
// (`project.yml`): a mistake here fails CI's xcodebuild, which is the whole
// reason for Metal over a runtime string.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

/// The packed image's pixel CENTRE, in the lattice's working-space
/// coordinates, for lattice point `i` (already clamped) in a cube of `n`:
/// tile `i.z`, column `i.x` within it, row `i.y`.
static inline float2 latticeTexel(int3 i, int n) {
    return float2(float(i.z * n + i.x) + 0.5, float(i.y) + 0.5);
}

/// Map a colour onto the cube's declared input domain, exactly as
/// `latticeCoords` does in `CubeLut.swift` — including its span == 0 gives 0
/// rule. Most cubes declare [0,1], for which this is clamp(rgb, 0, 1): a
/// value above white lands on the lattice's edge, the web's CLAMP_TO_EDGE.
static inline float3 normalizeDomain(float3 rgb, float3 domainMin, float3 domainMax) {
    float3 span = domainMax - domainMin;
    bool3 degenerate = span == float3(0.0);
    // Guard the divide BEFORE it happens: a zero span gives inf, and select()
    // picks rather than blends, so an inf would survive the pick.
    float3 safeSpan = select(span, float3(1.0), degenerate);
    float3 unit = clamp((rgb - domainMin) / safeSpan, float3(0.0), float3(1.0));
    return select(unit, float3(0.0), degenerate);
}

extern "C" {
namespace coreimage {

/// The graded colour: `src` looked up in the packed `lut` and mixed toward by
/// `intensity` — 0 the source, 1 the look as authored, above 1 past it
/// (nothing clamps the overshoot; the half-float chain keeps it for a later
/// pass, as the web's does). `lutSize` is N; `tetrahedral` is 1 for the
/// tetrahedral read and 0 for trilinear; `domainMin` / `domainMax` are the
/// cube's declared input domain. Alpha passes through.
float4 cubeLookup(coreimage::sampler src, coreimage::sampler lut, float lutSize, float intensity,
                  float tetrahedral, float3 domainMin, float3 domainMax)
{
    float4 pixel = src.sample(src.coord());
    // Core Image hands a pass PREMULTIPLIED colour; the web's graph works on
    // straight colour, and a look on a premultiplied value would darken a
    // soft edge. Both are the identity on an opaque picture.
    float4 straight = unpremultiply(pixel);
    float3 rgb = straight.rgb;

    int n = int(lutSize);
    int last = n - 1;
    float3 p = normalizeDomain(rgb, domainMin, domainMax) * float(last);
    float3 base = floor(p);
    float3 f = p - base;
    int3 i0 = int3(base);
    int3 lo = int3(0);
    int3 hi = int3(last);

    // The cell's eight corners, each index clamped like CLAMP_TO_EDGE, each
    // read exactly at its pixel centre (the web's `texelFetch`).
    float3 c000 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(0, 0, 0), lo, hi), n))).rgb;
    float3 c100 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(1, 0, 0), lo, hi), n))).rgb;
    float3 c010 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(0, 1, 0), lo, hi), n))).rgb;
    float3 c110 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(1, 1, 0), lo, hi), n))).rgb;
    float3 c001 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(0, 0, 1), lo, hi), n))).rgb;
    float3 c101 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(1, 0, 1), lo, hi), n))).rgb;
    float3 c011 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(0, 1, 1), lo, hi), n))).rgb;
    float3 c111 = lut.sample(lut.transform(latticeTexel(clamp(i0 + int3(1, 1, 1), lo, hi), n))).rgb;

    float3 looked;
    if (tetrahedral > 0.5) {
        // Tetrahedral (Kasson): order the fractions to pick one of 6
        // tetrahedra, then interpolate from its 4 vertices — `interpolate.ts`
        // branch for branch.
        if (f.r > f.g) {
            if (f.g > f.b) {
                // fx > fy > fz — vertices c000, c100, c110, c111
                looked = c000 + (c100 - c000) * f.r + (c110 - c100) * f.g + (c111 - c110) * f.b;
            } else if (f.r > f.b) {
                // fx > fz > fy — vertices c000, c100, c101, c111
                looked = c000 + (c100 - c000) * f.r + (c111 - c101) * f.g + (c101 - c100) * f.b;
            } else {
                // fz > fx > fy — vertices c000, c001, c101, c111
                looked = c000 + (c101 - c001) * f.r + (c111 - c101) * f.g + (c001 - c000) * f.b;
            }
        } else if (f.b > f.g) {
            // fz > fy > fx — vertices c000, c001, c011, c111
            looked = c000 + (c111 - c011) * f.r + (c011 - c001) * f.g + (c001 - c000) * f.b;
        } else if (f.b > f.r) {
            // fy > fz > fx — vertices c000, c010, c011, c111
            looked = c000 + (c111 - c011) * f.r + (c010 - c000) * f.g + (c011 - c010) * f.b;
        } else {
            // fy > fx > fz — vertices c000, c010, c110, c111
            looked = c000 + (c110 - c010) * f.r + (c010 - c000) * f.g + (c111 - c110) * f.b;
        }
    } else {
        // Trilinear: the weighted average of the eight corners, red first,
        // then green, then blue — `sampleTrilinear`'s order.
        float3 c00 = c000 + (c100 - c000) * f.r;
        float3 c10 = c010 + (c110 - c010) * f.r;
        float3 c01 = c001 + (c101 - c001) * f.r;
        float3 c11 = c011 + (c111 - c011) * f.r;
        float3 c0 = c00 + (c10 - c00) * f.g;
        float3 c1 = c01 + (c11 - c01) * f.g;
        looked = c0 + (c1 - c0) * f.b;
    }

    // Blend toward the look; above 1 extrapolates past it. Written out rather
    // than Metal's mix(), whose result is undefined outside [0, 1] — GLSL's is
    // not, and a strength of 1.5 is a feature on the web.
    float3 graded = rgb + (looked - rgb) * intensity;
    return premultiply(float4(graded, straight.a));
}

}
}
