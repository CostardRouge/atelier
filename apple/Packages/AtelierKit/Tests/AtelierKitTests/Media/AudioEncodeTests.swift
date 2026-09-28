// The kernel's own spec for the pure half of `src/shared/media/audio-encode.ts`
// (the web's has no twin: its encoder is WebCodecs'). What it pins is what
// the web decides around the encoder — the priming a bed is led by, the
// blocks it is fed in, their stamps, and the tail cut after the flush.

import XCTest
@testable import AtelierKit

final class AudioEncodeFormatTests: XCTestCase {
    func testAsksForAacLcAtTheWebsBitrateOneAacFrameAtATime() {
        XCTAssertEqual(aacCodec, "mp4a.40.2")
        XCTAssertEqual(aacBitrate, 128_000)
        XCTAssertEqual(aacFramesPerChunk, 1024)
    }

    /// 2112 samples, measured by decoding the web's MP4s back: 44 ms at 48 kHz.
    func testThePrimingIsTheMeasured2112SamplesInSecondsAtTheBedsRate() {
        XCTAssertEqual(aacPrimingSamples, 2112)
        assertClose(aacPrimingSeconds(48000), 0.044, 12)
        assertClose(aacPrimingSeconds(44100), 2112.0 / 44100, 12)
    }
}

final class AudioEncodeSliceTests: XCTestCase {
    func testConcatenatesEachChannelsFramesOneChannelAfterTheOther() {
        let buffer = PlanarAudio(sampleRate: 48000, channels: [[1, 2, 3, 4], [5, 6, 7, 8]])
        XCTAssertEqual(planarSlice(buffer, 1, 2), [2, 3, 6, 7])
    }

    func testASliceRunningPastTheEndIsZeroPaddedToItsCount() {
        let buffer = PlanarAudio(sampleRate: 48000, channels: [[1, 2, 3], [4, 5, 6]])
        XCTAssertEqual(planarSlice(buffer, 2, 3), [3, 0, 0, 6, 0, 0])
    }

    func testFeedsABedInWholeAacFramesTheLastOneShortStampedInMicroseconds() {
        let slices = audioChunkSlices(length: 2500, sampleRate: 48000)
        XCTAssertEqual(slices.map(\.start), [0, 1024, 2048])
        XCTAssertEqual(slices.map(\.count), [1024, 1024, 452])
        XCTAssertEqual(slices.map(\.timestampMicros), [0, 21333, 42667])
        XCTAssertEqual(audioChunkSlices(length: 0, sampleRate: 48000), [])
    }
}

final class AudioEncodeTailTests: XCTestCase {
    /// The flush's padding, kept, made the track ~75 ms longer than the picture.
    func testDropsThePacketsStampedAtOrPastTheEndOfTheSignal() {
        let stamps: [Double] = [0, 21333, 42667, 64000]
        XCTAssertEqual(trimEncoderTail(stamps, length: 2048, sampleRate: 48000) { $0 }, [0, 21333])
        XCTAssertEqual(trimEncoderTail(stamps, length: 2049, sampleRate: 48000) { $0 }, [0, 21333, 42667])
    }

    func testKeepsEverythingRatherThanNothingShouldNoPacketSurviveTheCut() {
        let stamps: [Double] = [50_000, 71_333]
        XCTAssertEqual(trimEncoderTail(stamps, length: 1024, sampleRate: 48000) { $0 }, stamps)
    }
}
