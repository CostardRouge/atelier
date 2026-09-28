// What we let the muxer say about our colours — and, more often, what we stop
// it from saying. Port of `src/shared/media/colour-tag.ts`.
//
// The web's mp4-muxer writes an MP4 `colr` nclx box from the `colorSpace` on
// the metadata the encoder hands back, which is how its exports come to be
// correctly tagged bt709 without any code asking for it (`media-pipeline.md`).
// It builds that box with plain map lookups and NO bounds check: an unmapped
// value writes 0, and for matrix coefficients 0 means Identity/RGB — not
// "unknown" but an active, wrong claim that players will act on.
//
// A wrong tag is worse than no tag: an untagged file is merely guessed at,
// consistently, by each player, whereas a file whose container contradicts
// its bitstream renders differently in QuickTime, Premiere and the browser.
// So the rule is all-or-nothing — either the colour space is fully specified
// and every field is encodable, or it is stripped and the file carries no
// `colr`. The partial case is the subtle one: `{ primaries: 'bt709' }` alone
// still writes matrix=0, and a missing `fullRange` still writes 0 (limited) —
// a guess, and guessing range wrong is a visible contrast error.
//
// The WebCodecs records are plain structs here; the decision is the same.

import Foundation

/// Exactly the strings mp4-muxer 5.2.2 can encode. Keep in step with it.
private let encodablePrimaries: Set<String> = ["bt709", "bt470bg", "smpte170m"]
private let encodableTransfer: Set<String> = ["bt709", "smpte170m", "iec61966-2-1"]
private let encodableMatrix: Set<String> = ["rgb", "bt709", "bt470bg", "smpte170m"]

/// WebCodecs' `VideoColorSpaceInit`, every field optional as there — a
/// browser may report any of them absent, or a value outside its own enums.
public struct VideoColorSpaceInit: Equatable, Sendable {
    public var primaries: String?
    public var transfer: String?
    public var matrix: String?
    public var fullRange: Bool?

    public init(primaries: String? = nil, transfer: String? = nil, matrix: String? = nil, fullRange: Bool? = nil) {
        self.primaries = primaries; self.transfer = transfer; self.matrix = matrix; self.fullRange = fullRange
    }
}

/// WebCodecs' `VideoDecoderConfig`, the part a muxer reads.
public struct VideoDecoderConfig: Equatable, Sendable {
    public var codec: String
    public var codedWidth: Int?
    public var codedHeight: Int?
    public var description: [UInt8]?
    /// Three states, as the web's `undefined | null | init`: `nil` is absent
    /// (nothing to guard), `.some(nil)` is a null the browser wrote (stripped),
    /// `.some(cs)` is a colour space to check.
    public var colorSpace: VideoColorSpaceInit??

    public init(codec: String, codedWidth: Int? = nil, codedHeight: Int? = nil, description: [UInt8]? = nil, colorSpace: VideoColorSpaceInit?? = nil) {
        self.codec = codec; self.codedWidth = codedWidth; self.codedHeight = codedHeight; self.description = description; self.colorSpace = colorSpace
    }
}

/// WebCodecs' `EncodedVideoChunkMetadata`: what an encoder hands back beside a chunk.
public struct EncodedVideoChunkMetadata: Equatable, Sendable {
    public var decoderConfig: VideoDecoderConfig?
    public init(decoderConfig: VideoDecoderConfig? = nil) { self.decoderConfig = decoderConfig }
}

/// True when every field is present and within what the muxer can write.
/// Deliberately strict: a partially specified colour space is a mis-tag
/// waiting to happen, not a partial improvement.
public func isEncodableColorSpace(_ cs: VideoColorSpaceInit?) -> Bool {
    guard let cs else { return false }
    guard let primaries = cs.primaries, encodablePrimaries.contains(primaries) else { return false }
    guard let transfer = cs.transfer, encodableTransfer.contains(transfer) else { return false }
    guard let matrix = cs.matrix, encodableMatrix.contains(matrix) else { return false }
    return cs.fullRange != nil
}

/// Metadata that is safe to hand to the muxer.
///
/// Returns the argument untouched in the normal case — a fully specified,
/// encodable colour space, which is what Chrome reports for a canvas-sourced
/// frame. Otherwise returns a COPY with `colorSpace` removed, so no `colr`
/// box is written at all; every other field of `decoderConfig` (`codec`,
/// `codedWidth`, `codedHeight`, `description`) survives.
public func safeChunkMetadata(_ meta: EncodedVideoChunkMetadata?) -> EncodedVideoChunkMetadata? {
    guard let meta, let config = meta.decoderConfig, let colorSpace = config.colorSpace else { return meta }
    if isEncodableColorSpace(colorSpace) { return meta }

    var stripped = config
    stripped.colorSpace = nil
    return EncodedVideoChunkMetadata(decoderConfig: stripped)
}
