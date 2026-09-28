// The CAMERA's own warp — a DNG's `WarpRectilinear`, per colour plane, as ONE
// pass: the web's `src/shared/render/camera-warp-pass.ts`, transcribed. The
// pure twin the gate holds it to is `warpSourceUv` in the kernel's
// `Render/CameraWarp.swift` (`apple/AtelierTests/Render/CameraWarpPassTests.swift`).
//
// Three planes are sampled at three positions of one radius, as the lens pass
// samples three scales of one; green is the reference and decides whether a
// pixel exists at all, and a channel whose own map took it off the picture
// keeps green's rather than painting a coloured edge of its own.
//
// NOT radial about the frame's centre: the optical centre is the FILE's. So
// it asks WHERE a pixel is, in IMAGE coordinates — [0,1]², y DOWN from the top
// of the picture, the space `camera-warp.ts` states the map in. Core Image's
// working space runs y UP from the bottom of the extent, so the kernel is
// handed the picture's extent and converts both ways (`warpImageUv`,
// `warpWorkingPoint`) — the native twin of the web's `imageUv` rule
// (`render-geometry.md`), derived here and pinned by the gate with the
// optical centre deliberately off the middle.
//
// A `sampler`'s `sample()` takes SAMPLER-space coordinates: every read goes
// through `transform()`. The source arrives clamped to its extent, so the
// bilinear read at the last half pixel is the web's CLAMP_TO_EDGE.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

/// A working-space point as an IMAGE point: [0,1]², y down from the top of
/// the picture whose extent is `extent` = (x, y, width, height).
static inline float2 warpImageUv(float2 p, float4 extent) {
    return float2((p.x - extent.x) / extent.z, 1.0 - (p.y - extent.y) / extent.w);
}

/// The inverse: an image point back in working-space coordinates.
static inline float2 warpWorkingPoint(float2 uv, float4 extent) {
    return float2(extent.x + uv.x * extent.z, extent.y + (1.0 - uv.y) * extent.w);
}

static inline bool warpOutside(float2 uv) {
    return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

/// Mirrors `warpSourcePoint` in CameraWarp.swift: the radial ratio, then the
/// two tangential terms — Brown–Conrady's own arrangement, and dng_sdk's.
static inline float2 warpSourcePoint(float2 n, float4 k, float2 t) {
    float r2 = dot(n, n);
    float ratio = k.x + k.y * r2 + k.z * r2 * r2 + k.w * r2 * r2 * r2;
    return float2(ratio * n.x + t.x * (r2 + 2.0 * n.x * n.x) + 2.0 * t.y * n.x * n.y,
                  ratio * n.y + t.y * (r2 + 2.0 * n.y * n.y) + 2.0 * t.x * n.x * n.y);
}

extern "C" {
namespace coreimage {

/// `src` corrected by the file's own rectilinear warp. `extent` is the
/// picture's (x, y, width, height) in working space; `center` the OPTICAL
/// centre in image [0,1]; `span` (width, height) over the normalising radius;
/// `radialR/G/B` k0..k3 per plane, `tangentialR/G/B` the two tangential terms.
float4 cameraWarp(coreimage::sampler src, float4 extent, float2 center, float2 span,
                  float4 radialR, float4 radialG, float4 radialB,
                  float2 tangentialR, float2 tangentialG, float2 tangentialB,
                  coreimage::destination dest)
{
    float2 img = warpImageUv(dest.coord(), extent);
    float2 n = (img - center) * span;

    float2 uvG = center + warpSourcePoint(n, radialG, tangentialG) / span;
    // Outside the picture is EMPTY, never the edge pixel smeared outwards —
    // the refusal the lens and the keystone both make.
    if (warpOutside(uvG)) return float4(0.0);
    // Straight colour, as the web's graph works on: Core Image hands a pass
    // premultiplied values, and three planes from three places must be
    // recombined under ONE alpha. The identity on an opaque picture.
    float4 green = unpremultiply(src.sample(src.transform(warpWorkingPoint(uvG, extent))));

    float2 uvR = center + warpSourcePoint(n, radialR, tangentialR) / span;
    float2 uvB = center + warpSourcePoint(n, radialB, tangentialB) / span;
    float3 rgb = green.rgb;
    if (!warpOutside(uvR)) rgb.r = unpremultiply(src.sample(src.transform(warpWorkingPoint(uvR, extent)))).r;
    if (!warpOutside(uvB)) rgb.b = unpremultiply(src.sample(src.transform(warpWorkingPoint(uvB, extent)))).b;
    return premultiply(float4(rgb, green.a));
}

}
}
