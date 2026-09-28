// Port of `src/shared/media/audio-mix.test.ts` (`mixPlanar`). The web's
// `decodeAacWindow` drives WebCodecs' `AudioDecoder`; the native decode is
// `AVAssetReader`'s, in the app.

import Foundation
import XCTest
@testable import AtelierKit

/// `Math.fround` — a double as the nearest Float, back as a double.
private func fround(_ x: Double) -> Double { Double(Float(x)) }

/// `+v.toFixed(5)`.
private func fixed5(_ v: Float) -> Double { (Double(v) * 100_000).rounded(.toNearestOrAwayFromZero) / 100_000 }

private func audio(_ rate: Double, _ channels: [Float]...) -> PlanarAudio {
    PlanarAudio(sampleRate: rate, channels: channels)
}

final class AudioMixTests: XCTestCase {
    func testSumsTheBedIntoAStereoClipChannelForChannel() {
        let out = mixPlanar(audio(48000, [0.1, 0.2, 0.3], [-0.1, 0, 0.1]), audio(48000, [0.5, 0, 0], [0, 0.5, 0]))
        XCTAssertEqual(out.channelData(0).map { Double($0) }, [0.6, 0.2, 0.3].map(fround))
        XCTAssertEqual(out.channelData(1).map(fixed5), [-0.1, 0.5, 0.1])
    }

    func testFoldsAStereoBedDownToTheMiddleOfAMonoClip() {
        let out = mixPlanar(audio(44100, [0, 0]), audio(44100, [0.4, 0], [0, 0.4]))
        XCTAssertEqual(out.channelData(0).map(fixed5), [0.2, 0.2])
    }

    func testClampsInsteadOfWrappingWhenTheSumPassesFullScale() {
        let out = mixPlanar(audio(48000, [0.9, -0.9]), audio(48000, [0.5, -0.5]))
        XCTAssertEqual(out.channelData(0), [1, -1])
    }

    func testKeepsTheClipsLengthAndLayoutALongerBedNeverExtendsIt() {
        let out = mixPlanar(audio(48000, [0, 0], [0, 0]), audio(48000, [0.1, 0.1, 0.1, 0.1], [0.1, 0.1, 0.1, 0.1]))
        XCTAssertEqual(out.length, 2)
        XCTAssertEqual(out.numberOfChannels, 2)
    }

    func testNeverWritesIntoTheClipItWasHanded() {
        let clip = audio(48000, [0.1, 0.1])
        _ = mixPlanar(clip, audio(48000, [0.5, 0.5]))
        XCTAssertEqual(clip.channelData(0).map { Double($0) }, [0.1, 0.1].map(fround))
    }

    func testAppliesTheBedsGainBeforeSumming() {
        let out = mixPlanar(audio(48000, [0]), audio(48000, [0.8]), 0.5)
        XCTAssertEqual(fixed5(out.channelData(0)[0]), 0.4)
    }
}
