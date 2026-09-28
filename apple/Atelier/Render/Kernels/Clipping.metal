// The CLIPPING VIEW — `clipOf`, painted over the picture on the stage (J):
// the web's `src/shared/render/clip-pass.ts`, transcribed. The pure rule the
// gate holds it to is `clipOf` (`Histogram.swift`) and the marks are
// `clipMarks` (`Render/Clipping.swift`), handed in as arguments so the
// numbers live in ONE place (`apple/AtelierTests/Render/ClippingPassTests.swift`).
//
// A way of LOOKING, like a mask's wash: the stage puts it after every pass
// that shapes the picture, and nothing that leaves ever asks for it.
//
// The test is made on the value the 8-bit output WILL hold: a float the
// encoder rounds to 254 is at or past 253.5 / 255, one it rounds to 1 is under
// 1.5 / 255 — so the overlay and the histogram strip count the same pixels.
// White when ANY channel is there, black when EVERY one is: every channel
// under the line is the brightest one under it.
//
// A colour kernel: one output pixel from the pixel under it, and no position.

#include <metal_stdlib>
using namespace metal;
#include <CoreImage/CoreImage.h>

extern "C" {
namespace coreimage {

/// `s` painted `whiteMark` where it has clipped to white and `blackMark`
/// where it has crushed to black. `whiteAt` is the code (0..255) at or past
/// which the brightest channel is clipped; `blackUnder` the code under which
/// it is crushed.
float4 clippingView(coreimage::sample_t s, float3 whiteMark, float3 blackMark, float whiteAt, float blackUnder)
{
    float4 straight = unpremultiply(s);
    float3 codes = clamp(straight.rgb, float3(0.0), float3(1.0)) * 255.0;
    float top = max(codes.r, max(codes.g, codes.b));
    if (top >= whiteAt) return premultiply(float4(whiteMark, straight.a));
    if (top < blackUnder) return premultiply(float4(blackMark, straight.a));
    return s;
}

}
}
