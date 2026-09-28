// The KEYSTONE — a homography, the first pass that moves a pixel: the web's
// `src/shared/render/keystone-pass.ts`, transcribed. The pure twin the gate
// holds it to is `keystoneSampleMatrix` / `keystoneMatrix` in the kernel's
// `Render/Keystone.swift` (`apple/AtelierTests/Render/KeystonePassTests.swift`).
//
// A warp is drawn by walking the OUTPUT and asking where each pixel came from,
// so the kernel carries the INVERSE (destination → source), built and
// inverted in Swift where a spec holds it; this only applies it.
//
// **The y convention, derived rather than copied.** The matrix is stated in
// IMAGE space — centred, (±0.5, ±0.5) the corners, y DOWN from the top of the
// picture. On the web `v_uv`'s y is not even constant (it flips for an
// ImageBitmap and not for a canvas), hence `imageUv`. Here it is constant but
// UPSIDE DOWN: Core Image's working space runs y UP from the bottom of the
// extent. So the kernel is handed the picture's extent and converts BOTH ways
// — the output point into image space before the matrix, the source point
// back into working space before the read. The gate drives a marker turned
// 90 degrees, where a missing or doubled flip lands it in a different
// quadrant, and a gradient pixel by pixel against the twin.
//
// Where the picture ran out it is EMPTY, never the edge pixel smeared outward;
// a point bent through the horizon has no source and is empty too.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

static inline float2 keystoneImageUv(float2 p, float4 extent) {
    return float2((p.x - extent.x) / extent.z, 1.0 - (p.y - extent.y) / extent.w);
}

static inline float2 keystoneWorkingPoint(float2 uv, float4 extent) {
    return float2(extent.x + uv.x * extent.z, extent.y + (1.0 - uv.y) * extent.w);
}

extern "C" {
namespace coreimage {

/// `src` warped by the sample matrix, handed as its three ROWS (`row0`..`row2`,
/// row-major as `Matrix3` holds it, so no transpose can go wrong); `extent`
/// is the picture's (x, y, width, height) in working space.
float4 keystoneWarp(coreimage::sampler src, float4 extent, float3 row0, float3 row1, float3 row2,
                    coreimage::destination dest)
{
    float2 img = keystoneImageUv(dest.coord(), extent);
    float3 q = float3(img - 0.5, 1.0);
    float3 s = float3(dot(row0, q), dot(row1, q), dot(row2, q));
    // Bent through the horizon: no source point exists, so nothing is drawn.
    if (abs(s.z) < 1e-6) return float4(0.0);
    float2 at = s.xy / s.z + 0.5;
    // Outside the picture is EMPTY, never the edge pixel smeared outwards.
    if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) return float4(0.0);
    return src.sample(src.transform(keystoneWorkingPoint(at, extent)));
}

}
}
