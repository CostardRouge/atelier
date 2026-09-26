// PRESENCE — dehaze, clarity, texture: a wide estimate of something (the
// luma, or the haze) and the pixel moved against it. The web's
// `src/shared/render/presence-pass.ts`, transcribed; the pure twins the gate
// holds these kernels to are AtelierKit's `presenceBlur`, `dehazeAt` and
// `localContrastAt`, composed by `applyPresence` (`Render/Presence.swift`,
// `apple/AtelierTests/Render/PresencePassTests.swift`).
//
// Two kernels a slider, as on the web — the signal blurred along X, then
// that blurred along Y and the pixel moved — but where the web carries the
// X estimate in ALPHA because a WebGL pass sees only its input, here the
// estimate is its own image, handed to the second kernel as a second
// sampler: one node of the graph draws both (`PresencePass.swift`), so a
// kernel that will not run leaves the picture whole rather than half-drawn.
//
// The blur's geometry (sigma, the spacing of its taps, how many a side) is
// computed ONCE by the twin's own `blurGeometry` and handed in, so the
// kernel and the twin cannot disagree about it. Taps are spaced past a pixel
// and read BILINEARLY from a sampler over the picture clamped to its extent —
// the twin's `sampleBilinear`, the web's LINEAR + CLAMP_TO_EDGE.
//
// Colours are handled STRAIGHT (unpremultiplied on read, premultiplied on
// write), the identity on an opaque picture. Reads through a sampler are
// macros, never helper functions taking a sampler; helper names carry `pr`.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

/// The straight colour at working-space point `p` of sampler `s`.
#define PR_STRAIGHT(s, p) unpremultiply((s).sample((s).transform(p)))

/// BT.709 luma of encoded RGB — `lumaOf`.
static inline float prLuma(float3 c) {
    return 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
}

/// An unnormalised Gaussian weight.
static inline float prGauss(float x, float sigma) {
    return exp(-(x * x) / (2.0f * sigma * sigma));
}

/// sRGB code → linear light, the input CLAMPED to [0,1] first — the twin's
/// `toLinear(_, .srgb)` clamps, so this one does too.
static inline float prDecode(float v) {
    float c = clamp(v, 0.0f, 1.0f);
    return c <= 0.04045f ? c / 12.92f : pow((c + 0.055f) / 1.055f, 2.4f);
}

/// Linear light → sRGB code, clamped to [0,1] first — `fromLinear(_, .srgb)`,
/// its linear knee derived from the encoded one as `Transfer.swift` derives it.
static inline float prEncode(float v) {
    float c = clamp(v, 0.0f, 1.0f);
    return c <= (0.04045f / 12.92f) ? c * 12.92f : 1.055f * pow(c, 1.0f / 2.4f) - 0.055f;
}

/// RGB brought to a new luma by one ratio; black stays black — `scaleToLuma`.
static inline float3 prScaleToLuma(float3 c, float y, float target) {
    if (y <= 1e-6f) return float3(target);
    return max(c * (target / y), float3(0.0f));
}

extern "C" {
namespace coreimage {

/// The H half of `presenceBlur`: the signal of each bilinear tap along X —
/// the luma, or (`dark` > 0.5) the DARK CHANNEL, the smallest channel in
/// LINEAR light — averaged under a Gaussian. `blur` is the twin's
/// `blurGeometry`: (sigma, spacing, taps a side). The estimate is written to
/// every channel with alpha 1, so nothing downstream reads it as coverage.
float4 presenceBlur(coreimage::sampler src, float dark, float3 blur, coreimage::destination dest)
{
    float2 p = dest.coord();
    float sigma = blur.x;
    float spacing = blur.y;
    int taps = int(blur.z);
    float acc = 0.0f;
    float sum = 0.0f;
    for (int k = -taps; k <= taps; k++) {
        float d = float(k) * spacing;
        float w = prGauss(d, sigma);
        float3 n = PR_STRAIGHT(src, p + float2(d, 0.0f)).rgb;
        float signal = dark > 0.5f
            ? min(prDecode(n.r), min(prDecode(n.g), prDecode(n.b)))
            : prLuma(n);
        acc += w * signal;
        sum += w;
    }
    float estimate = acc / sum;
    return float4(estimate, estimate, estimate, 1.0f);
}

/// The V half and the move: `estimate` (the H half's image) blurred along Y
/// with the same geometry, then the pixel of `src` moved against it — `op` 0
/// dehaze (`dehazeAt`, the veil inverted in LINEAR light), 1 clarity and
/// 2 texture (`localContrastAt`, the luma moved, clarity weighted to the
/// midtones). `amount` is −1..1. `haze` is (dehazeFloor, dehazeStrength,
/// hazeAdded, softLimit) and `gains` (contrastGain up, down): the twin's
/// constants, handed in so they live in one place.
float4 presenceApply(coreimage::sampler src, coreimage::sampler estimate, float op, float amount,
                     float3 blur, float4 haze, float2 gains, coreimage::destination dest)
{
    float2 p = dest.coord();
    float4 c = unpremultiply(src.sample(src.coord()));
    float sigma = blur.x;
    float spacing = blur.y;
    int taps = int(blur.z);
    float acc = 0.0f;
    float sum = 0.0f;
    for (int k = -taps; k <= taps; k++) {
        float d = float(k) * spacing;
        float w = prGauss(d, sigma);
        acc += w * estimate.sample(estimate.transform(p + float2(0.0f, d))).r;
        sum += w;
    }
    float blurred = acc / sum;

    float3 moved;
    if (op < 0.5f) {
        // Dehaze. `blurred` is the veil: the dark channel, in linear light.
        float3 lin = float3(prDecode(c.r), prDecode(c.g), prDecode(c.b));
        if (amount > 0.0f) {
            float t = max(haze.x, 1.0f - haze.y * amount * blurred);
            float3 clear = max((lin - 1.0f) / t + 1.0f, float3(0.0f));
            moved = float3(prEncode(clear.r), prEncode(clear.g), prEncode(clear.b));
        } else {
            float t = 1.0f + haze.z * amount;
            float3 veiled = lin * t + (1.0f - t);
            moved = float3(prEncode(veiled.r), prEncode(veiled.g), prEncode(veiled.b));
        }
    } else {
        // Clarity (op 1) and texture (op 2): the luma against its blur.
        float y = prLuma(c.rgb);
        float gain = amount * (amount > 0.0f ? gains.x : gains.y);
        float bell = op < 1.5f ? clamp(4.0f * y * (1.0f - y), 0.0f, 1.0f) : 1.0f;
        float detail = y - blurred;
        float soft = detail / (1.0f + haze.w * abs(detail));
        moved = prScaleToLuma(c.rgb, y, max(0.0f, y + gain * soft * bell));
    }
    return premultiply(float4(moved, c.a));
}

}
}
