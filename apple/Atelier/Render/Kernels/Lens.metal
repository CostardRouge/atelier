// The LENS correction as ONE pass — distortion, lateral CA and vignetting,
// with a MEASURED profile (Lensfun) composed under the sliders in the same
// pass: the web's `src/shared/render/lens-pass.ts`, transcribed. The pure
// twins the gate holds it to are `lensSampleRadius`, `profileSourceRadius`,
// `profileChannelRadius`, `vignetteEncoded` and `profileVignetteGain` in the
// kernel's `Render/Lens.swift` (`apple/AtelierTests/Render/LensPassTests.swift`).
//
// All three are functions of the radius alone, so the radius is computed once,
// each channel sampled at its own scale of it and the gain applied there:
// three passes would resample three times, and every resample after the
// first is blur paid for nothing.
//
// RADIAL about the frame's centre, so a y mirror is invisible to it — no flip
// is needed for correctness. It is nonetheless computed in IMAGE coordinates
// (y down from the top), the space every geometry twin states its map in, and
// converted to and from Core Image's y-up working space with the picture's
// extent, so the three geometry kernels share one convention.
//
// The vignette gain is on LIGHT: decode, multiply, encode, with the web's
// piecewise sRGB curve, unclamped above white.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

static inline float2 lensImageUv(float2 p, float4 extent) {
    return float2((p.x - extent.x) / extent.z, 1.0 - (p.y - extent.y) / extent.w);
}

static inline float2 lensWorkingPoint(float2 uv, float4 extent) {
    return float2(extent.x + uv.x * extent.z, extent.y + (1.0 - uv.y) * extent.w);
}

static inline bool lensOutside(float2 uv) {
    return uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
}

static inline float3 lensSrgbToLinear(float3 c) {
    float3 a = abs(c);
    float3 lin = select(pow((a + 0.055) / 1.055, float3(2.4)), a / 12.92, a <= float3(0.04045));
    return sign(c) * lin;
}

static inline float3 lensLinearToSrgb(float3 c) {
    float3 a = abs(c);
    float3 enc = select(1.055 * pow(a, float3(1.0 / 2.4)) - 0.055, a * 12.92, a <= float3(0.04045 / 12.92));
    return sign(c) * enc;
}

extern "C" {
namespace coreimage {

/// `src` through the lens correction. `extent` is the picture's (x, y, width,
/// height); `span` the frame in a space whose half-DIAGONAL is 1; `k` the
/// sliders' (k1, k2); `chroma` the red and blue scales against green;
/// `vignette` (amount, start); `pd` the profile's distortion d1..d4; `tcaRed` /
/// `tcaBlue` its red and blue TCA (v, c, b); `pv` its vignetting k1..k3, at the
/// SOURCE radius.
float4 lensCorrection(coreimage::sampler src, float4 extent, float2 span, float2 k, float2 chroma,
                      float2 vignette, float4 pd, float3 tcaRed, float3 tcaBlue, float3 pv,
                      coreimage::destination dest)
{
    // Centred, and scaled so the frame's own corner sits at radius 1.
    float2 d = (lensImageUv(dest.coord(), extent) - 0.5) * span;
    float r = length(d);
    float2 dir = r > 0.0 ? d / r : float2(0.0);
    // Mirrors lensSampleRadius, then profileSourceRadius (Horner's form in both).
    float r2 = r * r;
    float m = r * (1.0 + k.x * r2 + k.y * r2 * r2);
    float rs = m * (1.0 + m * (pd.x + m * (pd.y + m * (pd.z + m * pd.w))));

    float2 uvG = dir * rs / span + 0.5;
    // Outside the picture is EMPTY, never the edge pixel smeared outwards.
    if (lensOutside(uvG)) return float4(0.0);
    float4 green = unpremultiply(src.sample(src.transform(lensWorkingPoint(uvG, extent))));

    float3 rgb = green.rgb;
    // Mirrors profileChannelRadius, times the sliders' own scale.
    float scaleR = chroma.x * (tcaRed.x + rs * (tcaRed.y + rs * tcaRed.z));
    float scaleB = chroma.y * (tcaBlue.x + rs * (tcaBlue.y + rs * tcaBlue.z));
    if (scaleR != 1.0 || scaleB != 1.0) {
        float2 uvR = dir * (rs * scaleR) / span + 0.5;
        float2 uvB = dir * (rs * scaleB) / span + 0.5;
        // A channel whose own scale took it off the picture keeps green's.
        if (!lensOutside(uvR)) rgb.r = unpremultiply(src.sample(src.transform(lensWorkingPoint(uvR, extent)))).r;
        if (!lensOutside(uvB)) rgb.b = unpremultiply(src.sample(src.transform(lensWorkingPoint(uvB, extent)))).b;
    }

    float gain = 1.0;
    if (vignette.x != 0.0 && r > vignette.y) {
        float t = (r - vignette.y) / max(1e-6f, 1.0f - vignette.y);
        // Squared, so there is no visible ring where the lift begins.
        gain = 1.0 + vignette.x * t * t;
    }
    // The measured vignetting, at the SOURCE radius (profileVignetteGain).
    float rs2 = rs * rs;
    gain /= 1.0 + rs2 * (pv.x + rs2 * (pv.y + rs2 * pv.z));
    if (gain != 1.0) {
        rgb = lensLinearToSrgb(lensSrgbToLinear(rgb) * gain);
    }
    return premultiply(float4(rgb, green.a));
}

}
}
