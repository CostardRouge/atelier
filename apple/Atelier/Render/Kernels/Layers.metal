// ADJUSTMENT LAYERS — a develop that applies only where its mask says: the
// web's `src/shared/render/layer-pass.ts`, transcribed term for term, over the
// pure twins in the kernel (`Render/Mask.swift`'s `maskAt` and `combineMask`,
// `Develop/Layer.swift`'s `layerWeight`). The gate that holds these kernels
// to them is `apple/AtelierTests/Render/LayerPassTests.swift`.
//
//     out = mix(under, gradeThroughLut(under), mask × opacity)
//
// Split into small kernels rather than the web's one fragment, because Core
// Image is lazy and a kernel is cheap to compose: the MASK is built as an
// image one component at a time — the layer's own shape first, then each PART
// combined with what is there (`layerMask*`, each carrying the running mask
// in `prev`) — the LOOK is the graph's own cube kernel (`Cube.metal`, the one
// tested lookup, never a second copy), and `layerMix` mixes the two by the
// mask, holed by the subtracted subject and scaled by the opacity. The ORDER
// is `layerWeight`'s and it is the point: own mask → its invert → each part
// turned by ITS invert and combined in order → the `except` hole → opacity.
//
// Coordinates. A mask is a function of WHERE, in IMAGE coordinates — (0,0) at
// the top left, the web's `imageUv` — while Core Image's working space runs y
// UP. `layerImageUv` flips once, here. A raster (a painted mask, a segmented
// subject) is an image whose FIRST memory row is the TOP of the picture, which
// Core Image places at the top as well (the cube gate pins that convention),
// so a raster is sampled in plain y-up normalised coordinates and no flip
// enters there.
//
// Every value is read at a pixel CENTRE (`dest.coord()`), and a raster is read
// through a LINEAR sampler at a coordinate clamped to its texel centres — the
// web's CLAMP_TO_EDGE + LINEAR, exactly.
//
// Metal, compiled at build time under `-fcikernel` / `-cikernel`. Helpers are
// `static inline` (a translation unit of their own, so no symbol can collide
// with another family's), and nothing takes a sampler as a helper argument:
// what reads a sampler is written where the sampler was declared.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

/// `smoothStep01` in `Mask.swift`: 0 at or below 0, 1 at or above 1, cubic
/// between — GLSL's `smoothstep(0, 1, s)`, the ramp every shape fades along.
static inline float layerSmooth(float s) {
    if (!(s > 0.0f)) return 0.0f;
    if (s >= 1.0f) return 1.0f;
    return s * s * (3.0f - 2.0f * s);
}

/// Rec. 709 luma — `rec709Luma` in `Mask.swift`, the brightness a luma band
/// and a colour range select on (never the develop's, which it modulates).
static inline float layerLuma(float3 c) {
    return dot(c, float3(0.2126f, 0.7152f, 0.0722f));
}

/// One component folded into the running mask. `rule.x` is the op — −1 for
/// the layer's OWN mask (its value replaces what is there), 0 add, 1 subtract,
/// 2 intersect, `combineMask`'s three — and `rule.y` the component's invert,
/// applied to ITS value before it combines (`layerWeight`).
static inline float layerCombine(float m, float v, float4 rule) {
    float turned = rule.y > 0.5f ? 1.0f - v : v;
    if (rule.x < -0.5f) return turned;
    if (rule.x > 1.5f) return m * turned;           // intersect: m × v
    if (rule.x > 0.5f) return m * (1.0f - turned);   // subtract: m × (1 − v)
    return max(m, turned);                         // add: the larger — a union
}

/// A working-space point as IMAGE coordinates in [0,1]: x across, y DOWN
/// from the top of the frame — `imageUv` on the web.
static inline float2 layerImageUv(float2 p, float4 frame) {
    float2 q = (p - frame.xy) / frame.zw;
    return float2(q.x, 1.0f - q.y);
}

/// A working-space point as the texel coordinate of a raster of `size`, both
/// y-up, clamped to the raster's texel centres (CLAMP_TO_EDGE under LINEAR).
static inline float2 layerRasterAt(float2 p, float4 frame, float2 size) {
    float2 q = (p - frame.xy) / frame.zw;
    return clamp(q * size, float2(0.5f), size - 0.5f);
}

/// A mask value, as the mask image carries it.
static inline float4 layerOut(float m) {
    return float4(m, m, m, 1.0f);
}

extern "C" {
namespace coreimage {

/// A component that is ONE value everywhere: no mask at all (the WHOLE
/// picture, 1), or a raster kind with no map yet (an empty painting, a
/// subject the model has not answered — NOTHING, 0).
float4 layerMaskFlat(coreimage::sampler prev, float value, float4 rule)
{
    float m = prev.sample(prev.coord()).r;
    return layerOut(layerCombine(m, value, rule));
}

/// A straight edge with a soft transition — `maskAt`'s linear branch.
/// `shape` is (centre.x, centre.y, direction.x, direction.y), the centre
/// already in the half-diagonal space (`framePoint`), the direction the side
/// the mask covers; `rule.z` is the feather. `span` is the frame in that
/// space: (ar/d · 2, 1/d · 2), d the diagonal.
float4 layerMaskLinear(coreimage::sampler prev, float4 frame, float2 span, float4 shape, float4 rule,
                       coreimage::destination dest)
{
    float2 img = layerImageUv(dest.coord(), frame);
    float2 p = (img - 0.5f) * span;
    float t = dot(p - shape.xy, shape.zw);
    float f = rule.z;
    // Centred on the line: half the fade each side, so the line a panel draws
    // is where the mask reads 0.5.
    float v = f <= 0.0f ? (t >= 0.0f ? 1.0f : 0.0f) : layerSmooth(t / f + 0.5f);
    float m = prev.sample(prev.coord()).r;
    return layerOut(layerCombine(m, v, rule));
}

/// An ellipse, turned — `maskAt`'s radial branch: 1 inside, 0 by `feather`
/// past it. `shape` is (centre.x, centre.y, radius.x, radius.y), `turn` the
/// (cos, sin) of its angle.
float4 layerMaskRadial(coreimage::sampler prev, float4 frame, float2 span, float4 shape, float2 turn, float4 rule,
                       coreimage::destination dest)
{
    float2 img = layerImageUv(dest.coord(), frame);
    float2 p = (img - 0.5f) * span;
    float2 o = p - shape.xy;
    // Into the ellipse's own frame.
    float2 q = float2(o.x * turn.x + o.y * turn.y, -o.x * turn.y + o.y * turn.x);
    float e = length(q / max(shape.zw, float2(1e-6f)));
    float f = rule.z;
    float v = f <= 0.0f ? (e <= 1.0f ? 1.0f : 0.0f) : layerSmooth((1.0f + f - e) / f);
    float m = prev.sample(prev.coord()).r;
    return layerOut(layerCombine(m, v, rule));
}

/// A band of BRIGHTNESS — `maskAt`'s luma branch, on the pixel's own luma.
/// `band` is (from, to); `rule.z` the feather past each end.
float4 layerMaskLuma(coreimage::sampler src, coreimage::sampler prev, float2 band, float4 rule)
{
    // Straight colour, as the web's graph carries it; the identity on an
    // opaque picture.
    float3 rgb = unpremultiply(src.sample(src.coord())).rgb;
    float luma = layerLuma(rgb);
    float f = rule.z;
    float v;
    if (f <= 0.0f) {
        v = (luma >= band.x && luma <= band.y) ? 1.0f : 0.0f;
    } else {
        float up = layerSmooth((luma - (band.x - f)) / f);
        float down = layerSmooth((band.y + f - luma) / f);
        v = up * down;
    }
    float m = prev.sample(prev.coord()).r;
    return layerOut(layerCombine(m, v, rule));
}

/// A COLOUR RANGE — `colourRangeAt`: the pixel in the opponent plane
/// (r − g, (r + g)/2 − b) plus luma at half weight, the NEAREST sample
/// deciding. The samples arrive already in that space, packed three floats
/// each into `c0…c3` (sample k at floats 3k, 3k+1, 3k+2); `rule.z` is how
/// many there are (at most 5, `maxColourSamples`) and `rule.w` the reach
/// (`colourReach`): full inside it, gone by twice it.
float4 layerMaskColour(coreimage::sampler src, coreimage::sampler prev, float4 rule,
                       float4 c0, float4 c1, float4 c2, float4 c3)
{
    float3 rgb = unpremultiply(src.sample(src.coord())).rgb;
    float3 o = float3(rgb.r - rgb.g, (rgb.r + rgb.g) * 0.5f - rgb.b, layerLuma(rgb));
    float4 packed[4] = { c0, c1, c2, c3 };
    int count = int(rule.z + 0.5f);
    float reach = max(rule.w, 1e-6f);
    float best = 0.0f;
    for (int k = 0; k < 5; k++) {
        if (k >= count) break;
        int i = k * 3;
        float3 at3 = float3(packed[i / 4][i % 4], packed[(i + 1) / 4][(i + 1) % 4], packed[(i + 2) / 4][(i + 2) % 4]);
        float3 d = o - at3;
        float dist = length(float3(d.x, d.y, d.z * 0.5f));
        best = max(best, 1.0f - layerSmooth((dist - reach) / reach));
    }
    float m = prev.sample(prev.coord()).r;
    return layerOut(layerCombine(m, best, rule));
}

/// A RASTER kind — a painted mask (`rasteriseBrush`) or a segmented subject —
/// read bilinearly from its alpha map in its red channel. `size` is the
/// raster's own size in texels.
float4 layerMaskRaster(coreimage::sampler prev, coreimage::sampler raster, float4 frame, float2 size, float4 rule,
                       coreimage::destination dest)
{
    float v = raster.sample(raster.transform(layerRasterAt(dest.coord(), frame, size))).r;
    float m = prev.sample(prev.coord()).r;
    return layerOut(layerCombine(m, v, rule));
}

/// The layer drawn: the picture under it mixed toward its own graded self by
/// the mask, holed by the SUBTRACTED subject (`cut`, whose presence is
/// `amounts.y`) and scaled by the opacity (`amounts.x`). At a weight of 0 the
/// mix returns the picture exactly — nothing here is a no-op by luck.
float4 layerMix(coreimage::sampler src, coreimage::sampler graded, coreimage::sampler shape, coreimage::sampler cut,
                float4 frame, float2 cutSize, float2 amounts, coreimage::destination dest)
{
    float4 under = unpremultiply(src.sample(src.coord()));
    float3 looked = unpremultiply(graded.sample(graded.coord())).rgb;
    float m = shape.sample(shape.coord()).r;
    float held = cut.sample(cut.transform(layerRasterAt(dest.coord(), frame, cutSize))).r;
    float w = m * (1.0f - amounts.y * held) * amounts.x;
    // Written out rather than mix(): the same arithmetic the twin does.
    float3 rgb = under.rgb + (looked - under.rgb) * w;
    return premultiply(float4(rgb, under.a));
}

/// Show-the-mask as a LINE: where the mask crosses one half — tested at the
/// pixel and 1.5 pixels either side, the web's `MAIN_OUTLINE` — drawn in
/// dashes of ink and paper so it holds over a white sky and a black coat
/// alike. The weight WITHOUT the opacity: a layer at 30 % still has its edge
/// where its mask is. Everywhere else the picture is untouched.
float4 layerOutline(coreimage::sampler src, coreimage::sampler shape, coreimage::sampler cut,
                    float4 frame, float2 cutSize, float hasCut, coreimage::destination dest)
{
    float4 under = unpremultiply(src.sample(src.coord()));
    float2 p = dest.coord();
    float2 dx = float2(1.5f, 0.0f);
    float2 dy = float2(0.0f, 1.5f);
    float c = shape.sample(shape.transform(p)).r
        * (1.0f - hasCut * cut.sample(cut.transform(layerRasterAt(p, frame, cutSize))).r);
    float a = shape.sample(shape.transform(p + dx)).r
        * (1.0f - hasCut * cut.sample(cut.transform(layerRasterAt(p + dx, frame, cutSize))).r);
    float b = shape.sample(shape.transform(p - dx)).r
        * (1.0f - hasCut * cut.sample(cut.transform(layerRasterAt(p - dx, frame, cutSize))).r);
    float e = shape.sample(shape.transform(p + dy)).r
        * (1.0f - hasCut * cut.sample(cut.transform(layerRasterAt(p + dy, frame, cutSize))).r);
    float f = shape.sample(shape.transform(p - dy)).r
        * (1.0f - hasCut * cut.sample(cut.transform(layerRasterAt(p - dy, frame, cutSize))).r);
    float hi = max(max(max(a, b), max(e, f)), c);
    float lo = min(min(min(a, b), min(e, f)), c);
    float edge = (lo < 0.5f && hi >= 0.5f) ? 1.0f : 0.0f;
    // Dashes in the render's own pixels, counted from the frame's bottom-left
    // pixel centre as `gl_FragCoord` counts them.
    float2 at = p - frame.xy;
    float dash = fmod(floor((at.x + at.y) / 6.0f), 2.0f);
    float3 ink = float3(0.08f) + (float3(0.97f) - float3(0.08f)) * dash;
    float3 rgb = under.rgb + (ink - under.rgb) * edge;
    return premultiply(float4(rgb, under.a));
}

}
}
