// The FILM node — a stock's TEXTURE, grain and halation: the web's
// `src/shared/render/film-pass.ts`, transcribed. Every formula is a copy of
// the pure twins in the kernel — `Film/FilmGrain.swift` (`grainWeight`,
// `applyGrain`, `combineOctaves`, `extractHighlight`, `screenHalation`,
// `blurSeparable` with `gaussianKernel`'s weights), `Film/FilmNoise.swift`
// (`sampleGrainTile`, `grainPhase`) and `Film/FilmTexture.swift`
// (`grainUniforms`, `halationBuffer`) — never a re-derivation, so the gate
// (`apple/AtelierTests/Render/FilmPassTests.swift`) can hold these kernels to
// them the way the web's `scripts/check-render.mjs` holds its GLSL.
//
// Three kernels:
// - `filmExtract` keeps what bleeds: each pixel's luminance above the
//   threshold, renormalised, times its colour (a warm highlight bleeds warm);
// - `filmBlur` is ONE axis of the separable Gaussian, clamped to the buffer's
//   edge, over the weights `gaussianKernel` computed on the CPU and handed in
//   (symmetric, so its half: `w[|k|]`) — one kernel implementation in the
//   repo, and it is the tested one;
// - `filmNode` screens the blurred halo onto the picture, then adds the
//   grain: halation first because light scatters at EXPOSURE and silver
//   develops after.
//
// Coordinates. The node works in the frame's own normalised coordinate with
// y UP — the web's `quadUv`, which a framebuffer write and a Core Image
// working space share — so the grain field and the halo land where the web
// puts them. The noise tile is read as `sampleGrainTile` reads it: memory row
// `iy` at uv.y ≈ iy / size, REPEAT-wrapped and bilinear. Core Image has no
// REPEAT wrap, so the kernel wraps the texel INDICES itself, reads the four
// texels at their centres through a NEAREST sampler and interpolates them —
// the twin's arithmetic, in float32, rather than a GPU's 8-bit sub-texel
// filter. A tile's first memory row is the TOP of its image (the cube gate's
// convention), so memory row `iy` sits at Core Image y = size − 1 − iy.
//
// Metal, compiled at build time under `-fcikernel` / `-cikernel`. Helpers are
// `static inline`; what reads a sampler is written where the sampler was
// declared (the texel read is a macro over the kernel's own samplers).

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

/// Rec. 709 luminance — the `lumR/lumG/lumB` `FilmGrain.swift` weighs with.
static inline float filmLuma(float3 c) {
    return dot(c, float3(0.2126f, 0.7152f, 0.0722f));
}

/// The four texels a bilinear read of the tile blends, REPEAT-wrapped, and
/// the fractions between them — `sampleGrainTile`'s set-up, line for line.
struct FilmTap {
    int xa;
    int xb;
    int ya;
    int yb;
    float fx;
    float fy;
};

static inline int filmWrap(int i, int n) {
    return ((i % n) + n) % n;
}

static inline FilmTap filmTap(float2 uv, float size) {
    int n = int(size);
    float x = uv.x * size - 0.5f;
    float y = uv.y * size - 0.5f;
    float x0 = floor(x);
    float y0 = floor(y);
    FilmTap t;
    t.fx = x - x0;
    t.fy = y - y0;
    t.xa = filmWrap(int(x0), n);
    t.xb = filmWrap(int(x0) + 1, n);
    t.ya = filmWrap(int(y0), n);
    t.yb = filmWrap(int(y0) + 1, n);
    return t;
}

/// Where memory texel (ix, iy) of the tile sits in Core Image's y-up space:
/// its centre, the first memory row at the top.
static inline float2 filmTexel(int ix, int iy, float size) {
    return float2(float(ix) + 0.5f, size - float(iy) - 0.5f);
}

/// The bilinear blend of four texels, minus the half that makes a sample
/// signed — `sampleGrainTile`'s `top * (1 − fy) + bottom * fy − 0.5`.
static inline float4 filmBlend(float4 a, float4 b, float4 c, float4 d, float fx, float fy) {
    float4 top = a * (1.0f - fx) + b * fx;
    float4 bottom = c * (1.0f - fx) + d * fx;
    return top * (1.0f - fy) + bottom * fy - 0.5f;
}

// One texel of the tile as a sample in `GrainSample` order — (luma, r, g, b):
// the luma field from its own image, the three per-channel fields from the
// other. A macro over the kernel's own `tileRgb` / `tileLuma` samplers.
#define FILM_TEXEL(ix, iy) float4( \
    tileLuma.sample(tileLuma.transform(filmTexel((ix), (iy), grainDial.z))).r, \
    tileRgb.sample(tileRgb.transform(filmTexel((ix), (iy), grainDial.z))).rgb)

extern "C" {
namespace coreimage {

/// `extractHighlight`: the luminance above `threshold`, renormalised to 0..1,
/// times the colour. Alpha 1 — the halo is energy, not a picture.
float4 filmExtract(coreimage::sampler src, float threshold)
{
    float3 c = unpremultiply(src.sample(src.coord())).rgb;
    float l = filmLuma(c);
    float span = max(1e-6f, 1.0f - threshold);
    float e = clamp((l - threshold) / span, 0.0f, 1.0f);
    return float4(c * e, 1.0f);
}

/// One axis of `blurSeparable`: `axis.xy` is one texel along this axis and
/// zero along the other, `axis.z` the number of taps (odd, at most 79,
/// `maxHalationTaps`). `box` is the buffer's extent (x, y, w, h): every read is
/// clamped to its texel centres, CLAMP_TO_EDGE. `w0…w9` are the kernel's
/// weights from the centre out — `gaussianKernel` is symmetric, so tap k
/// weighs `w[|k|]`, 40 of them for the widest kernel.
float4 filmBlur(coreimage::sampler src, float4 axis, float4 box,
                float4 w0, float4 w1, float4 w2, float4 w3, float4 w4,
                float4 w5, float4 w6, float4 w7, float4 w8, float4 w9,
                coreimage::destination dest)
{
    float4 weights[10] = { w0, w1, w2, w3, w4, w5, w6, w7, w8, w9 };
    int taps = int(axis.z + 0.5f);
    int reach = (taps - 1) / 2;
    float2 p = dest.coord();
    float2 lo = box.xy + 0.5f;
    float2 hi = box.xy + box.zw - 0.5f;
    float3 acc = float3(0.0f);
    for (int k = -reach; k <= reach; k++) {
        int j = k < 0 ? -k : k;
        float2 q = clamp(p + axis.xy * float(k), lo, hi);
        acc += src.sample(src.transform(q)).rgb * weights[j / 4][j % 4];
    }
    return float4(acc, 1.0f);
}

/// The node's own draw over the graded picture.
///
/// `frame` is the picture's extent (x, y, w, h). `grainAt` is the grain's
/// (scale.x, scale.y, phase.x, phase.y) — `grainUniforms`' aspect × scale and
/// `grainPhase` for this SOURCE frame; `grainDial` is (amount × fade, chroma,
/// the tile's size, `grainGain`); `octave` is (`octaveScale`, `octaveWeight`,
/// 1 / √(1 + w²), 0). `bleed` is (halation, has a halo, the halo buffer's
/// width, its height) and `tint` the bleed's colour.
///
/// Each half is the IDENTITY where its own term is zero — never `1 − (1 − c)`
/// and never a clamp — so an untouched pixel comes back untouched, headroom
/// included.
float4 filmNode(coreimage::sampler src, coreimage::sampler tileRgb, coreimage::sampler tileLuma, coreimage::sampler halo,
                float4 frame, float4 grainAt, float4 grainDial, float4 octave, float4 bleed, float3 tint,
                coreimage::destination dest)
{
    float4 straight = unpremultiply(src.sample(src.coord()));
    float3 c = straight.rgb;
    float2 quad = (dest.coord() - frame.xy) / frame.zw;

    // Halation — `screenHalation` over the halo read LINEAR at this point of
    // the small buffer, clamped to its texel centres.
    if (bleed.y > 0.5f) {
        float2 size = bleed.zw;
        float2 at = clamp(quad * size, float2(0.5f), size - 0.5f);
        float3 e = clamp(halo.sample(halo.transform(at)).rgb, float3(0.0f), float3(1.0f)) * clamp(bleed.x, 0.0f, 1.0f);
        float3 h = clamp(e * tint, float3(0.0f), float3(1.0f));
        if (any(e > float3(0.0f))) {
            c = 1.0f - (1.0f - clamp(c, float3(0.0f), float3(1.0f))) * (1.0f - h);
        }
    }

    // Grain — `applyGrain` over two octaves of the tile.
    float l = clamp(filmLuma(c), 0.0f, 1.0f);
    // `grainWeight`: zero at crushed black and blown white. The zero is said
    // outright rather than left to pow(0, 0.75): under fast math that goes
    // through log2(0), and an infinity there is not something to rely on.
    float bell = 4.0f * l * (1.0f - l);
    float weight = bell > 0.0f ? pow(bell, 0.75f) * (1.0f - 0.35f * l) : 0.0f;
    float k = grainDial.x * weight * grainDial.w;
    if (k > 0.0f) {
        float2 uv = quad * grainAt.xy + grainAt.zw;
        FilmTap a = filmTap(uv, grainDial.z);
        float4 n = filmBlend(FILM_TEXEL(a.xa, a.ya), FILM_TEXEL(a.xb, a.ya),
                             FILM_TEXEL(a.xa, a.yb), FILM_TEXEL(a.xb, a.yb), a.fx, a.fy);
        FilmTap b = filmTap(uv * octave.x, grainDial.z);
        float4 o = filmBlend(FILM_TEXEL(b.xa, b.ya), FILM_TEXEL(b.xb, b.ya),
                             FILM_TEXEL(b.xa, b.yb), FILM_TEXEL(b.xb, b.yb), b.fx, b.fy);
        n = (n + octave.y * o) * octave.z;
        // The luma field, pulled toward each channel's own by `chroma`.
        float3 field = n.x + (n.yzw - n.x) * grainDial.y;
        c = clamp(c + k * field, float3(0.0f), float3(1.0f));
    }

    return premultiply(float4(c, straight.a));
}

}
}
