// Clipping — what has gone to white or to black, pixel by pixel: the colours
// the stage paints it in, and how a readout tells a painted pixel from a
// photographed one. Port of `src/shared/render/clipping.ts`; its RULE
// (`clipWhite`, `clipBlack`, `Clip`, `clipOf`) was already ported beside the
// histogram in `Histogram.swift` and is reused here, never restated.
//
// The rules it keeps:
// - each mark has ONE channel at 255, which is what lets `readoutOf` know it:
//   a photographed pixel within a step of either colour has that channel at
//   254 or more, so it is itself clipped to white and was painted over — no
//   unpainted pixel can wear a mark;
// - with the clipping view on, a pixel wearing a mark is read as the clip it
//   marks, never as the mark's own numbers, which would be a fabricated value.

import Foundation

/// The colours a clipped pixel is painted in on the stage — Lightroom's own
/// (red for highlights, blue for shadows), because a photographer reads them
/// without a legend.
public let clipMarks: [Clip: (r: Int, g: Int, b: Int)] = [
    .white: (255, 0, 0),
    .black: (0, 128, 255),
]

/// What the pointer is over, said one way for every reader.
public enum Readout: Equatable, Sendable {
    case value(r: Double, g: Double, b: Double)
    case clip(Clip)
}

/// An 8-bit pixel read off the stage, as the author should be told it. A step
/// of tolerance, because a scaled draw can round a mark's inner pixel by one.
public func readoutOf(_ r: Double, _ g: Double, _ b: Double, clipping: Bool) -> Readout {
    if clipping {
        for clip in [Clip.white, .black] {
            guard let mark = clipMarks[clip] else { continue }
            if abs(r - Double(mark.r)) <= 1 && abs(g - Double(mark.g)) <= 1 && abs(b - Double(mark.b)) <= 1 {
                return .clip(clip)
            }
        }
    }
    return .value(r: r, g: g, b: b)
}

/// "R 212 · G 180 · B  96", or what the mark means.
public func readoutLabel(_ readout: Readout) -> String {
    switch readout {
    case .clip(let clip):
        return clip == .white ? "clipped to white" : "crushed to black"
    case .value(let r, let g, let b):
        // `Math.round` on a code value, padded to three columns.
        func n(_ v: Double) -> String {
            let s = String(Int(v.rounded()))
            return String(repeating: " ", count: max(0, 3 - s.count)) + s
        }
        return "R \(n(r)) · G \(n(g)) · B \(n(b))"
    }
}
