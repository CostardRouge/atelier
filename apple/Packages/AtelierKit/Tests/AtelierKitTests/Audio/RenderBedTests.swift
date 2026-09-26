// Port of `src/shared/audio/render-bed.test.ts` — the voices' table, the
// score and the peak guard. The web pins what the voices DO with a context
// through a stand-in that records every source started; here the stand-in is
// the sink the port already has, a plain `[VoicePart]`.

import XCTest
@testable import AtelierKit

final class AudioVoicesTableTests: XCTestCase {
    func testKnowsEveryVoiceItNamesAndNothingElse() {
        for name in voiceNames { XCTAssertTrue(isVoice(name.rawValue)) }
        XCTAssertFalse(isVoice("kazoo"))
        XCTAssertFalse(isVoice(nil))
    }

    func testStartsEveryPartOfAVoiceAtTheTimeItIsGiven() {
        var parts: [VoicePart] = []
        scheduleVoice(&parts, 1.25, "seat")
        XCTAssertGreaterThan(parts.count, 0)
        XCTAssertTrue(parts.allSatisfy { $0.start >= 1.25 && $0.start < 1.3 })
    }

    func testPlaysAnUnknownVoiceAsAClickRatherThanAsNothing() {
        var parts: [VoicePart] = []
        scheduleVoice(&parts, 0.5, "from-a-newer-build")
        XCTAssertGreaterThan(parts.count, 0)
        var click: [VoicePart] = []
        scheduleVoice(&click, 0.5, "click")
        XCTAssertEqual(parts, click)
    }

    func testNeverSchedulesBeforeZero() {
        var parts: [VoicePart] = []
        scheduleVoice(&parts, -3, "tick")
        XCTAssertGreaterThanOrEqual(parts.map(\.start).min() ?? -1, 0)
    }
}

final class AudioEventsWithinTests: XCTestCase {
    func testKeepsWhatTheBedCanPlayInTimeOrder() {
        let out = eventsWithin([
            SoundEvent(at: 1.2, voice: "seat"),
            SoundEvent(at: -0.1, voice: "tick"),
            SoundEvent(at: 0.3, voice: "detent"),
            SoundEvent(at: 4, voice: "tick"),
            SoundEvent(at: .nan, voice: "tick"),
        ], 2)
        XCTAssertEqual(out.map(\.at), [0.3, 1.2])
    }
}

final class AudioScheduleScoreTests: XCTestCase {
    let score = [
        SoundEvent(at: 0.1, voice: "detent"),
        SoundEvent(at: 0.6, voice: "leg"),
        SoundEvent(at: 1.9, voice: "seat"),
    ]

    func testSchedulesEachEventAtTheContextTimePlusItsOffsetIntoTheScore() {
        var parts: [VoicePart] = []
        XCTAssertEqual(scheduleScore(&parts, score, 10), 3)
        let starts = parts.map(\.start)
        assertClose(starts.min()!, 10.1, 6)
        XCTAssertGreaterThanOrEqual(starts.max()!, 11.9)
    }

    func testResumesMidScoreWhatAlreadyPlayedIsSkippedTheRestKeepsItsSpacing() {
        var parts: [VoicePart] = []
        XCTAssertEqual(scheduleScore(&parts, score, 5, 0.5), 2)
        assertClose(parts.map(\.start).min()!, 5.1, 6)
    }
}

final class AudioLimitPeakTests: XCTestCase {
    private func bed(_ channels: [Double]...) -> PlanarAudio {
        PlanarAudio(sampleRate: 48000, channels: channels.map { $0.map(Float.init) })
    }

    func testLeavesABedThatFitsUnderTheCeilingExactlyAsItWas() {
        let b = limitPeak(bed([0.2, -0.5, 0.9]))
        XCTAssertEqual(b.channelData(0), [0.2, -0.5, 0.9].map(Float.init))
    }

    func testBringsABedThatWouldClipUnderTheCeilingKeepingTheTicksInProportion() {
        let b = limitPeak(bed([0.7, -1.4], [0.35, 0]))
        let l = b.channelData(0).map(Double.init)
        let r = b.channelData(1).map(Double.init)
        assertClose(abs(l[1]), bedCeiling, 5)
        assertClose(l[0] / abs(l[1]), 0.5, 5)
        assertClose(r[0] / l[0], 0.5, 5)
    }
}
