// REPAIR — heal and clone, a patch list drawn FIRST on the source. The web's
// `src/shared/render/repair-pass.ts`, transcribed: the same coverage, the
// same ring weight, the same grid of means, the same order. The pure twin the
// gate holds this kernel to is AtelierKit's `repairAt` (`Render/Repair.swift`,
// `apple/AtelierTests/Render/RepairPassTests.swift`), which samples as GL's
// LINEAR + CLAMP_TO_EDGE does (`sampleAt`) — so the sampler here is Core
// Image's linear one over the picture clamped to its extent.
//
// A Core Image kernel takes no arrays, and a patch's numbers must stay exact
// 32-bit floats (a centre stored in a half-float image would sit 1.5 pixels
// off on a 6000-pixel picture), so the list is drawn in BATCHES of four
// patches handed as vector arguments: `RepairPass.swift` chains one kernel
// per batch, each reading the batch before (`prior`) and the ORIGINAL picture
// (`original`) — every patch reads the original, as the twin's `repairAt`
// and the web's one pass do, and mixes over what the patches before it made.
//
// Coordinates are the MASK's, in IMAGE space: a centre in [0,1] of the frame
// with v running DOWN from the top, a radius in the centred space whose
// half-diagonal is 1 (`span` turns [0,1] into it), the source an offset in
// frame units. Core Image's y runs UP, so a working-space point becomes
// (u, 1 − v) of the frame and back — the web's `imageUv`, done once, here.
//
// Colours are handled STRAIGHT (unpremultiplied on read, premultiplied on
// write), the identity on an opaque picture. Reads through a sampler are
// macros, never helper functions taking a sampler; helper names carry `rp`.
// No local is named `patch` — reserved in GLSL ES, and not worth finding out
// about in Metal: `pt`.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

/// The straight RGB of the ORIGINAL at IMAGE point `uv` of the frame
/// `frame` = (minX, minY, width, height) in working space — `sampleAt`.
#define RP_PICK(s, frame, uv) \
    unpremultiply((s).sample((s).transform(float2((frame).x + (uv).x * (frame).z, \
                                                  (frame).y + (1.0f - (uv).y) * (frame).w)))).rgb

/// GLSL's `smoothstep`, written out as the twin writes it.
static inline float rpSmoothstep(float a, float b, float x) {
    float t = clamp((x - a) / (b - a), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

/// How much of patch `pt` = (x, y, radius, feather) covers image point `img`:
/// 1 in its hard core, fading over the feathered rim to 0 at the radius —
/// `patchCoverageAt`.
static inline float rpCoverage(float4 pt, float2 img, float2 span) {
    float2 p = (img - 0.5f) * span;
    float2 c = (pt.xy - 0.5f) * span;
    float d = length(p - c);
    float hard = pt.z * (1.0f - pt.w);
    if (d <= hard) return 1.0f;
    if (d >= pt.z) return 0.0f;
    return 1.0f - rpSmoothstep(hard, pt.z, d);
}

/// The weight of image point `img` in the SURROUNDINGS of `pt`: nothing in
/// the hard core (that is the defect), full just outside the radius, gone at
/// `reachK` radii — `ringWeightAt`.
static inline float rpRing(float4 pt, float2 img, float2 span, float reachK) {
    float2 p = (img - 0.5f) * span;
    float2 c = (pt.xy - 0.5f) * span;
    if (length(p - c) >= pt.z * reachK) return 0.0f;
    return 1.0f - rpCoverage(pt, img, span);
}

extern "C" {
namespace coreimage {

/// Up to four patches over `prior`, each reading `original`. `frame` is the
/// picture's extent in working space; `span` the frame in the centred space
/// ((2·ar / diag, 2 / diag)); `shape` is (ringReach, meanGrid, how many of
/// the four slots are used). Slot i is `pi` = (x, y, radius, feather) and
/// `fi` = (dx, dy, kind — 0 clone, 1 heal —, unused).
float4 repairPatches(coreimage::sampler prior, coreimage::sampler original,
                     float4 frame, float2 span, float3 shape,
                     float4 p0, float4 p1, float4 p2, float4 p3,
                     float4 f0, float4 f1, float4 f2, float4 f3,
                     coreimage::destination dest)
{
    float2 q = dest.coord();
    float4 base = unpremultiply(prior.sample(prior.coord()));
    float3 outRgb = base.rgb;
    // The pixel in IMAGE space: u across, v DOWN from the top.
    float2 img = float2((q.x - frame.x) / frame.z, 1.0f - (q.y - frame.y) / frame.w);

    float reachK = shape.x;
    int grid = int(shape.y);
    int count = int(shape.z);
    float last = float(grid - 1);
    float4 pts[4] = { p0, p1, p2, p3 };
    float4 froms[4] = { f0, f1, f2, f3 };

    for (int i = 0; i < 4; i++) {
        if (i >= count) break;
        float4 pt = pts[i];
        float cov = rpCoverage(pt, img, span);
        if (cov <= 0.0f) continue;
        float2 offset = froms[i].xy;
        float3 copied = RP_PICK(original, frame, img + offset);
        float3 healed = copied;
        if (froms[i].z > 0.5f) {
            // `patchMeans`: the mean colour AROUND the destination and around
            // the source, over a grid × grid lattice of the ring's reach.
            float2 reach = float2(pt.z * reachK) / span;
            float3 around = float3(0.0f);
            float3 aroundSource = float3(0.0f);
            float sum = 0.0f;
            for (int j = 0; j < grid; j++) {
                for (int k = 0; k < grid; k++) {
                    float2 at = pt.xy + reach * ((float2(float(k), float(j)) / last) * 2.0f - 1.0f);
                    float w = rpRing(pt, at, span, reachK);
                    if (w <= 0.0f) continue;
                    around += RP_PICK(original, frame, at) * w;
                    aroundSource += RP_PICK(original, frame, at + offset) * w;
                    sum += w;
                }
            }
            if (sum > 0.0f) {
                around /= sum;
                aroundSource /= sum;
            }
            // The source's texture shifted by the difference of the two
            // means; with no ring at all both are 0, as the twin's are.
            healed = max(copied + around - aroundSource, float3(0.0f));
        }
        // Mixed over what came before by the coverage, written out.
        outRgb = outRgb + (healed - outRgb) * cov;
    }
    return premultiply(float4(outRgb, base.a));
}

}
}
