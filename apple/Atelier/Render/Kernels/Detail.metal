// DETAIL — the four neighbourhood kernels: colour noise, luminance noise,
// defringe, sharpen. The web's `src/shared/render/detail-pass.ts`, transcribed
// tap for tap; the pure twins the gate holds each kernel to are AtelierKit's
// `chromaBlurAt`, `bilateralAt`, `defringeAt`, `sharpenAt` and `sharpenMaskAt`
// (`Render/Detail.swift`, `apple/AtelierTests/Render/DetailPassTests.swift`).
//
// Every kernel reads its input through a sampler over the picture CLAMPED to
// its extent (`DetailPass.swift` hands `clampedToExtent()`), so a tap past the
// edge reads the edge — the twin's `pixelAt`, the web's CLAMP_TO_EDGE. Taps
// sit on whole-pixel offsets from `dest.coord()`, a pixel CENTRE, so the
// sampler returns the pixel itself whatever its filter.
//
// Colours are handled STRAIGHT, as the web's graph handles them: Core Image
// hands a kernel premultiplied values, so each read is unpremultiplied and the
// result premultiplied again — the identity on an opaque picture, which every
// decoded photograph is.
//
// A read through a sampler is a MACRO rather than a helper function, so no
// `coreimage::sampler` is ever passed by value outside a kernel; the helpers
// below take plain vectors only. Their names carry `dt` so nothing here can
// meet a name another kernel file or CoreImage.h declares.
//
// y runs UP in Core Image and DOWN in the twin's rows. Every kernel here is
// symmetric in y (a Gaussian, a bilateral, a max over the 3×3 ring, a Sobel
// MAGNITUDE), so the flip changes nothing; the Sobel is still written with
// its rows named the twin's way round.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

/// The straight colour at working-space point `p` of sampler `s`.
#define DT_STRAIGHT(s, p) unpremultiply((s).sample((s).transform(p)))
/// The BT.709 luma at working-space point `p` of sampler `s`.
#define DT_LUMA_AT(s, p) dtLuma(DT_STRAIGHT(s, p).rgb)

/// BT.709 luma of encoded RGB — `lumaOf`.
static inline float dtLuma(float3 c) {
    return 0.2126f * c.r + 0.7152f * c.g + 0.0722f * c.b;
}

/// Encoded RGB → (Y, Cb, Cr), BT.709, Cb and Cr centred on 0 — `toYcc`.
static inline float3 dtToYcc(float3 c) {
    float y = dtLuma(c);
    return float3(y, (c.b - y) / 1.8556f, (c.r - y) / 1.5748f);
}

/// The inverse — `fromYcc`.
static inline float3 dtFromYcc(float3 ycc) {
    float r = ycc.x + 1.5748f * ycc.z;
    float b = ycc.x + 1.8556f * ycc.y;
    float g = (ycc.x - 0.2126f * r - 0.0722f * b) / 0.7152f;
    return float3(r, g, b);
}

/// An unnormalised Gaussian weight.
static inline float dtGauss(float x, float sigma) {
    return exp(-(x * x) / (2.0f * sigma * sigma));
}

/// RGB brought to a new luma by one ratio; black stays black — `scaleToLuma`.
static inline float3 dtScaleToLuma(float3 c, float y, float target) {
    if (y <= 1e-6f) return float3(target);
    return max(c * (target / y), float3(0.0f));
}

/// GLSL's `smoothstep`, written out as the twin writes it.
static inline float dtSmoothstep(float a, float b, float x) {
    float t = clamp((x - a) / (b - a), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

extern "C" {
namespace coreimage {

/// ONE step of the chroma blur along `axis` ((1,0) or (0,1)): Cb and Cr
/// averaged under a Gaussian of `sigma` over `radius` taps a side, the luma
/// copied through untouched — `chromaBlurAt`.
float4 detailChromaBlur(coreimage::sampler src, float2 axis, float sigma, float radius,
                        coreimage::destination dest)
{
    float2 p = dest.coord();
    float4 c = DT_STRAIGHT(src, p);
    float y = dtLuma(c.rgb);
    float2 acc = float2(0.0f);
    float sum = 0.0f;
    int r = int(radius);
    for (int k = -r; k <= r; k++) {
        float w = dtGauss(float(k), sigma);
        float3 n = DT_STRAIGHT(src, p + axis * float(k)).rgb;
        acc += dtToYcc(n).yz * w;
        sum += w;
    }
    return premultiply(float4(dtFromYcc(float3(y, acc / sum)), c.a));
}

/// The bilateral on luma over the (2·radius + 1)² window, RGB following as
/// one ratio — `bilateralAt`. `radius` is the twin's `bilateralRadius` (3).
float4 detailBilateral(coreimage::sampler src, float rangeSigma, float spatialSigma, float radius,
                       coreimage::destination dest)
{
    float2 p = dest.coord();
    float4 c = DT_STRAIGHT(src, p);
    float y = dtLuma(c.rgb);
    float acc = 0.0f;
    float sum = 0.0f;
    int r = int(radius);
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            float2 d = float2(float(dx), float(dy));
            float ny = DT_LUMA_AT(src, p + d);
            float w = dtGauss(length(d), spatialSigma) * dtGauss(ny - y, rangeSigma);
            acc += ny * w;
            sum += w;
        }
    }
    return premultiply(float4(dtScaleToLuma(c.rgb, y, acc / sum), c.a));
}

/// Purple chroma at a steep luma edge, pulled toward neutral by `amount` —
/// `defringeAt`. `gates` is (purple from, purple to, edge from, edge to):
/// the twin's `defringePurple` and `defringeEdge`, handed in so the numbers
/// live in one place.
float4 detailDefringe(coreimage::sampler src, float amount, float4 gates, coreimage::destination dest)
{
    float2 p = dest.coord();
    float4 c = DT_STRAIGHT(src, p);
    float3 ycc = dtToYcc(c.rgb);
    // `edgeAt`: the largest luma difference to a 3×3 neighbour.
    float edge = 0.0f;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) continue;
            float ny = DT_LUMA_AT(src, p + float2(float(dx), float(dy)));
            edge = max(edge, abs(ny - ycc.x));
        }
    }
    float purple = dtSmoothstep(gates.x, gates.y, min(ycc.y, ycc.z));
    float steep = dtSmoothstep(gates.z, gates.w, edge);
    float keep = 1.0f - amount * purple * steep;
    return premultiply(float4(dtFromYcc(float3(ycc.x, ycc.yz * keep)), c.a));
}

/// The unsharp mask on luma — `sharpenAt`: a 2D Gaussian of `sigma` over
/// `radius` taps a side, the high-pass damped by `damp` (Detail) and weighted
/// by the Masking gate at `mask` (0 = everywhere), gained by `gain`, RGB
/// following as one ratio. `showMask` > 0.5 paints the Masking weight as grey
/// instead — `sharpenMaskAt`, a way of LOOKING the stage asks for.
float4 detailSharpen(coreimage::sampler src, float gain, float sigma, float radius, float damp, float mask,
                     float showMask, coreimage::destination dest)
{
    float2 p = dest.coord();
    float4 c = DT_STRAIGHT(src, p);
    float y = dtLuma(c.rgb);

    float m = 1.0f;
    if (mask > 0.0f) {
        // `edgeSobel`: the twin's rows run DOWN, Core Image's y runs UP, so
        // the twin's row below (y + 1) is Core Image's y − 1. The magnitude
        // is the same either way; it is written the twin's way round.
        float right = DT_LUMA_AT(src, p + float2(1.0f, 1.0f)) + 2.0f * DT_LUMA_AT(src, p + float2(1.0f, 0.0f))
            + DT_LUMA_AT(src, p + float2(1.0f, -1.0f));
        float left = DT_LUMA_AT(src, p + float2(-1.0f, 1.0f)) + 2.0f * DT_LUMA_AT(src, p + float2(-1.0f, 0.0f))
            + DT_LUMA_AT(src, p + float2(-1.0f, -1.0f));
        float below = DT_LUMA_AT(src, p + float2(-1.0f, -1.0f)) + 2.0f * DT_LUMA_AT(src, p + float2(0.0f, -1.0f))
            + DT_LUMA_AT(src, p + float2(1.0f, -1.0f));
        float above = DT_LUMA_AT(src, p + float2(-1.0f, 1.0f)) + 2.0f * DT_LUMA_AT(src, p + float2(0.0f, 1.0f))
            + DT_LUMA_AT(src, p + float2(1.0f, 1.0f));
        float gx = (right - left) / 8.0f;
        float gy = (below - above) / 8.0f;
        m = dtSmoothstep(0.25f * mask, mask, length(float2(gx, gy)));
    }
    if (showMask > 0.5f) {
        return premultiply(float4(float3(m), c.a));
    }

    float acc = 0.0f;
    float sum = 0.0f;
    int r = int(radius);
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            float2 d = float2(float(dx), float(dy));
            float w = dtGauss(length(d), sigma);
            acc += DT_LUMA_AT(src, p + d) * w;
            sum += w;
        }
    }
    float h = y - acc / sum;
    float damped = h / (1.0f + damp * abs(h));
    float outY = max(0.0f, y + gain * damped * m);
    return premultiply(float4(dtScaleToLuma(c.rgb, y, outY), c.a));
}

}
}
