// Port of `src/shared/media/colour-tag.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

/// What Chrome actually reports for a canvas-sourced frame — measured.
private let real = VideoColorSpaceInit(primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false)

/// `real` minus one field. The web's `null` and its absence are one thing
/// here — a non-boolean `fullRange` cannot be spelled on a `Bool?`.
private enum Field { case primaries, transfer, matrix, fullRange }
private func without(_ field: Field) -> VideoColorSpaceInit {
    var copy = real
    switch field {
    case .primaries: copy.primaries = nil
    case .transfer: copy.transfer = nil
    case .matrix: copy.matrix = nil
    case .fullRange: copy.fullRange = nil
    }
    return copy
}

/// The metadata an encoder hands back beside a chunk. `colorSpace` absent by
/// default; `.some(nil)` is the null a browser could write.
private func meta(_ colorSpace: VideoColorSpaceInit?? = nil) -> EncodedVideoChunkMetadata {
    EncodedVideoChunkMetadata(decoderConfig: VideoDecoderConfig(
        codec: "avc1.42001f", codedWidth: 1920, codedHeight: 1080, description: [1, 2, 3], colorSpace: colorSpace))
}

/// True when the config carries no `colorSpace` at all (the web's `'colorSpace' in config` false).
private func hasNoColorSpace(_ config: VideoDecoderConfig?) -> Bool {
    guard let config else { return false }
    if case .none = config.colorSpace { return true }
    return false
}

final class IsEncodableColorSpaceTests: XCTestCase {
    func testAcceptsTheColourSpaceChromeReportsForOurExports() {
        XCTAssertTrue(isEncodableColorSpace(real))
    }

    func testAcceptsEveryCombinationTheMuxerCanWrite() {
        for primaries in ["bt709", "bt470bg", "smpte170m"] {
            for transfer in ["bt709", "smpte170m", "iec61966-2-1"] {
                for matrix in ["rgb", "bt709", "bt470bg", "smpte170m"] {
                    XCTAssertTrue(isEncodableColorSpace(VideoColorSpaceInit(primaries: primaries, transfer: transfer, matrix: matrix, fullRange: true)))
                }
            }
        }
    }

    func testRejectsValuesTheMuxerWouldSilentlyWriteAs0() {
        // bt2020 / PQ / HLG are the realistic ones: HDR footage, or a browser
        // that starts reporting more than the three values it does today.
        var cs = real
        cs.primaries = "bt2020"
        XCTAssertFalse(isEncodableColorSpace(cs))
        cs = real
        cs.transfer = "pq"
        XCTAssertFalse(isEncodableColorSpace(cs))
        cs = real
        cs.transfer = "hlg"
        XCTAssertFalse(isEncodableColorSpace(cs))
        cs = real
        cs.matrix = "bt2020-ncl"
        XCTAssertFalse(isEncodableColorSpace(cs))
    }

    func testRejectsAPartialColourSpaceTheIdentityTrap() {
        // A missing matrix is not "unspecified": mp4-muxer writes 0, which
        // means Identity/RGB, an active and wrong claim.
        XCTAssertFalse(isEncodableColorSpace(without(.matrix)))
        XCTAssertFalse(isEncodableColorSpace(without(.primaries)))
        XCTAssertFalse(isEncodableColorSpace(without(.transfer)))
    }

    func testRejectsAMissingOrNonBooleanFullRangeFlag() {
        // Absent becomes 0 = limited, which is a guess; guessing range wrong is
        // a visible contrast error, not a subtle one.
        XCTAssertFalse(isEncodableColorSpace(without(.fullRange)))
        var nulled = real
        nulled.fullRange = nil
        XCTAssertFalse(isEncodableColorSpace(nulled))
    }

    func testRejectsNothingAtAll() {
        XCTAssertFalse(isEncodableColorSpace(nil))
    }
}

final class SafeChunkMetadataTests: XCTestCase {
    func testPassesTheRealCaseStraightThroughUnchanged() {
        let m = meta(real)
        XCTAssertEqual(safeChunkMetadata(m), m)
    }

    func testIsANoOpWhenThereIsNothingToGuard() {
        XCTAssertNil(safeChunkMetadata(nil))
        let bare = EncodedVideoChunkMetadata(decoderConfig: nil)
        XCTAssertEqual(safeChunkMetadata(bare), bare)
        let noColour = meta()
        XCTAssertEqual(safeChunkMetadata(noColour), noColour)
    }

    func testStripsAnUnencodableColourSpaceKeepingTheRestOfTheConfig() {
        var exotic = real
        exotic.matrix = "bt2020-ncl"
        let m = meta(exotic)
        let safe = safeChunkMetadata(m)!
        XCTAssertNotEqual(safe, m)
        XCTAssertTrue(hasNoColorSpace(safe.decoderConfig))
        // Everything the muxer actually needs must survive.
        XCTAssertEqual(safe.decoderConfig?.codec, "avc1.42001f")
        XCTAssertEqual(safe.decoderConfig?.codedWidth, 1920)
        XCTAssertEqual(safe.decoderConfig?.codedHeight, 1080)
        XCTAssertEqual(safe.decoderConfig?.description, [1, 2, 3])
    }

    func testNeverMutatesItsArgument() {
        // A value here, so nothing CAN be mutated — the web's rule (mp4-muxer
        // keeps the browser's object until finalize()) holds by construction.
        var exotic = real
        exotic.transfer = "pq"
        let m = meta(exotic)
        let before = m
        _ = safeChunkMetadata(m)
        XCTAssertEqual(m, before)
        XCTAssertEqual(m.decoderConfig?.colorSpace, .some(.some(exotic)))
    }

    func testStripsANullColourSpaceToo() {
        let safe = safeChunkMetadata(meta(.some(nil)))!
        XCTAssertTrue(hasNoColorSpace(safe.decoderConfig))
    }
}
