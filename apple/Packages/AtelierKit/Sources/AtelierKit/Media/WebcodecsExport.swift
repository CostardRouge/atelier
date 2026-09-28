// The pure half of `src/shared/media/webcodecs-export.ts`: the encode budget
// and the container's rotation. The pipeline itself (demux, decode, the
// per-frame transform, encode, mux) is the app's — `apple/Atelier/Video/
// VideoExport.swift`, on AVFoundation — and it reads these two answers from
// here so the web and the native export spend the same bits and turn a clip
// the same way.
//
// Left to the app, with the reason: `trimWindow` resolves a trim into DEMUXED
// sample indices (the sync sample before the in point, the last sample a
// B-frame could need, the lead of a B-framed file); `AVAssetReader` decodes
// from the sync sample itself and `AVAsset` applies the edit list, so the
// native export keeps only its third rule — rebase on the frame that COVERS
// the in point — and keeps it in the loop. `drawRotatedFrame` is a canvas
// paint (`CIImage.oriented` there). `buildAacAsc`, `pickAvcCodec` and
// `awaitQueue` are the browser's plumbing (an `AVAssetWriterInput` takes the
// format description, the codec, and says when it is ready).

import Foundation

/// Bits per pixel per frame. ~0.12 is close to worst case for an inter-frame
/// codec on ordinary footage, and GRAIN is the worst case: film grain is a new,
/// uncorrelated field every frame by construction, so there is nothing for a
/// P-frame to predict and the encoder spends its whole budget on noise. At 0.12
/// the grain the stock asked for is smeared into blocking; ~0.18 is what a
/// grained clip measures at.
private let bitsPerPixel = 0.12
private let grainedBitsPerPixel = 0.18
/// A postage stamp still gets 2 Mbps.
private let bitrateFloor = 2_000_000

/// An encode bitrate from resolution and frame rate. `grained` is set by a
/// caller whose grade carries a film texture with GRAIN in it — halation is a
/// blur and costs nothing.
public func deriveBitrate(_ width: Int, _ height: Int, _ framerate: Double, _ grained: Bool = false) -> Int {
    let bpp = grained ? grainedBitsPerPixel : bitsPerPixel
    let pixels = Double(width) * Double(height)
    let bits = pixels * framerate * bpp
    guard bits.isFinite else { return bitrateFloor }
    // `Math.round`, bounded so a nonsense size cannot trap the conversion.
    let rounded = min(bits, 1e15).rounded(.toNearestOrAwayFromZero)
    return max(bitrateFloor, Int(rounded))
}

/// JavaScript's `Math.round`: a half goes towards +∞ (so −90.5 → −90).
private func jsRoundHalfUp(_ x: Double) -> Double {
    (x + 0.5).rounded(.down)
}

/// The display rotation (0/90/180/270, clockwise) of a track's matrix, read
/// from its first two entries as `atan2(b, a)` and snapped to a quarter turn.
/// The decoder emits frames in coded orientation, so the container's rotation
/// must be copied to the output — or baked into the pixels — or the export
/// looks un-rotated. An absent or degenerate matrix is 0.
///
/// A `CGAffineTransform`'s `a` and `b` are the tkhd matrix's first two
/// entries, so the app hands `[t.a, t.b]` of a track's `preferredTransform`.
public func rotationFromMatrix(_ matrix: [Double]?) -> Int {
    guard let matrix, matrix.count >= 2 else { return 0 }
    let a = matrix[0]
    let b = matrix[1]
    if a == 0 && b == 0 { return 0 }
    let raw = jsRoundHalfUp(atan2(b, a) * 180 / .pi)
    // JavaScript's `%` keeps the dividend's sign, as `truncatingRemainder` does.
    let deg = (raw.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    let snapped = (jsRoundHalfUp(deg / 90) * 90).truncatingRemainder(dividingBy: 360)
    if snapped == 90 || snapped == 180 || snapped == 270 { return Int(snapped) }
    return 0
}
