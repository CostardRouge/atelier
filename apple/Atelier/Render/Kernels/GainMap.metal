// The camera's own SHADING, as a grid — a DNG's GainMap opcode as ONE pass,
// FIRST on the source: the web's `src/shared/render/gain-map-pass.ts`,
// transcribed. The pure twins the gate holds it to are `gainAt` and
// `gainEncoded` in the kernel's `Render/GainMapGrid.swift`
// (`apple/AtelierTests/Render/GainMapPassTests.swift`).
//
// It asks WHERE a pixel is, in IMAGE coordinates ([0,1]², y DOWN from the
// top), so it converts from Core Image's y-up working space with the
// picture's extent (`gainImageUv`): a grid read the other way up lifts the
// OPPOSITE corner, which is the worst outcome of all because it still looks
// like a correction (`render-gain-map.md`).
//
// The grid arrives as a small float image, node (j, i) — column j, row i
// counted DOWN from the top of the picture — at the pixel centre
// (j + 0.5, i + 0.5) (`GainMapPass.pack`), read through a NEAREST sampler:
// four exact fetches and a bilinear written out, the literal twin of
// `gainAt`, as the web's four `texelFetch`es are.
//
// In LIGHT, never on the code: decode, multiply, encode, with the web's
// piecewise sRGB curve, unclamped above white so the headroom survives.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

static inline float2 gainImageUv(float2 p, float4 extent) {
    return float2((p.x - extent.x) / extent.z, 1.0 - (p.y - extent.y) / extent.w);
}

/// The web's `SRGB_TRANSFER` (`glsl.ts`): the toe kept, the power extended
/// unclamped above white, the toe's slope mirrored below black.
static inline float3 gainSrgbToLinear(float3 c) {
    float3 a = abs(c);
    float3 lin = select(pow((a + 0.055) / 1.055, float3(2.4)), a / 12.92, a <= float3(0.04045));
    return sign(c) * lin;
}

static inline float3 gainLinearToSrgb(float3 c) {
    float3 a = abs(c);
    float3 enc = select(1.055 * pow(a, float3(1.0 / 2.4)) - 0.055, a * 12.92, a <= float3(0.04045 / 12.92));
    return sign(c) * enc;
}

extern "C" {
namespace coreimage {

/// `src` with the file's gain applied to its light. `grid` is the packed
/// field (NEAREST, clamped); `extent` the picture's (x, y, width, height);
/// `gridSize` (cols, rows); `origin` node (0,0) and `nodeStep` the distance
/// between nodes, both in image [0,1].
float4 gainMapGrid(coreimage::sampler src, coreimage::sampler grid, float4 extent,
                   float2 gridSize, float2 origin, float2 nodeStep, coreimage::destination dest)
{
    float4 straight = unpremultiply(src.sample(src.coord()));
    float2 img = gainImageUv(dest.coord(), extent);

    // Mirrors gainAt(): bilinear between the nodes, HELD at the edge outside them.
    float2 g = clamp((img - origin) / nodeStep, float2(0.0), gridSize - 1.0);
    float2 i0 = floor(g);
    float2 f = g - i0;
    float2 i1 = min(i0 + 1.0, gridSize - 1.0);
    float3 g00 = grid.sample(grid.transform(float2(i0.x, i0.y) + 0.5)).rgb;
    float3 g01 = grid.sample(grid.transform(float2(i1.x, i0.y) + 0.5)).rgb;
    float3 g10 = grid.sample(grid.transform(float2(i0.x, i1.y) + 0.5)).rgb;
    float3 g11 = grid.sample(grid.transform(float2(i1.x, i1.y) + 0.5)).rgb;
    float3 top = g00 * (1.0 - f.x) + g01 * f.x;
    float3 bottom = g10 * (1.0 - f.x) + g11 * f.x;
    float3 gain = top * (1.0 - f.y) + bottom * f.y;

    float3 rgb = gainLinearToSrgb(gainSrgbToLinear(straight.rgb) * gain);
    return premultiply(float4(rgb, straight.a));
}

}
}
