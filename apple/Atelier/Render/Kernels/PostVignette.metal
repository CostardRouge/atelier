// The POST-CROP VIGNETTE — Lightroom's Effects vignette, shaped in the
// DELIVERED frame: the web's `src/shared/render/post-vignette-pass.ts`,
// transcribed. The pure twins the gate holds it to are `postVignetteAt`,
// `shapeDistance` and `toFrame` in the kernel's `Render/PostVignette.swift`
// (`apple/AtelierTests/Render/PostVignettePassTests.swift`).
//
// The crop is drawn AFTER the graph, so the pass is handed the AFFINE from
// the picture's IMAGE coordinates ([0,1]², y DOWN from the top) to the frame's
// (`frameAffine`). It asks WHERE a pixel is, so it converts from Core Image's
// y-up working space with the picture's extent (`vignetteImageUv`) — the
// native twin of the web's `imageUv` rule — and the gate runs a turned,
// off-centre crop, where a flip cannot hide in a symmetry.
//
// The move is made in LINEAR light (the web decodes a CLAMPED value and
// encodes a clamped one, and so does this), and a bright pixel is spared a
// dark vignette by Highlights.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

static inline float2 vignetteImageUv(float2 p, float4 extent) {
    return float2((p.x - extent.x) / extent.z, 1.0 - (p.y - extent.y) / extent.w);
}

static inline float3 vignetteSrgbToLinear(float3 c) {
    float3 a = abs(c);
    float3 lin = select(pow((a + 0.055) / 1.055, float3(2.4)), a / 12.92, a <= float3(0.04045));
    return sign(c) * lin;
}

static inline float3 vignetteLinearToSrgb(float3 c) {
    float3 a = abs(c);
    float3 enc = select(1.055 * pow(a, float3(1.0 / 2.4)) - 0.055, a * 12.92, a <= float3(0.04045 / 12.92));
    return sign(c) * enc;
}

/// Mirrors `shapeDistance`: 1 at the middle of an edge, more toward a corner;
/// roundness blends toward a circle, or raises the norm toward a rounded
/// rectangle.
static inline float vignetteShapeDistance(float2 f, float aspect, float roundness) {
    float2 p = (f - 0.5) * 2.0;
    if (roundness > 0.0) {
        float2 q = aspect >= 1.0 ? float2(p.x, p.y / aspect) : float2(p.x * aspect, p.y);
        p += (q - p) * roundness;
    }
    float n = roundness < 0.0f ? 2.0f + 8.0f * -roundness : 2.0f;
    return pow(pow(abs(p.x), n) + pow(abs(p.y), n), 1.0f / n);
}

extern "C" {
namespace coreimage {

/// `src` vignetted in its delivered frame. `extent` is the picture's (x, y,
/// width, height); `rowU` / `rowV` the affine's two rows (u = dot(rowU,
/// (x, y, 1))); `aspect` the frame's width / height; `amount` −1..1; `start`
/// and `width` the falloff in shape distance; `roundness` −1..1; `highlights`
/// 0..1 (`postVignetteTerms`).
float4 postCropVignette(coreimage::sampler src, float4 extent, float3 rowU, float3 rowV,
                        float aspect, float amount, float start, float width,
                        float roundness, float highlights, coreimage::destination dest)
{
    float4 pixel = src.sample(src.coord());
    float3 img = float3(vignetteImageUv(dest.coord(), extent), 1.0);
    float2 f = float2(dot(rowU, img), dot(rowV, img));
    float t = smoothstep(start, start + width, vignetteShapeDistance(f, aspect, roundness));
    if (t <= 0.0 || amount == 0.0) return pixel;

    float4 straight = unpremultiply(pixel);
    float3 lin = vignetteSrgbToLinear(clamp(straight.rgb, float3(0.0), float3(1.0)));
    float3 outLin;
    if (amount < 0.0) {
        // A bright pixel is spared a dark vignette by Highlights — judged on
        // the ENCODED value, as the twin judges it.
        float y = dot(straight.rgb, float3(0.2126, 0.7152, 0.0722));
        float spare = 1.0 - highlights * smoothstep(0.5f, 1.0f, y);
        outLin = lin * (1.0 + amount * t * spare);
    } else {
        outLin = lin + (1.0 - lin) * amount * t;
    }
    return premultiply(float4(vignetteLinearToSrgb(clamp(outLin, float3(0.0), float3(1.0))), straight.a));
}

}
}
