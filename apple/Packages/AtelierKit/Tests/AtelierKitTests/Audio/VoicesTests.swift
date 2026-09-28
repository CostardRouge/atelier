// The kernel's own spec for the renderer, which the web has no twin of (its
// render is the browser's). The pinned samples were MEASURED on 2026-09-25 by
// running the web's own `renderBed` (esbuild of `src/shared/audio/render-bed.ts`)
// in headless Chrome 153's `OfflineAudioContext`, with the page's `onended`
// disconnects neutralised — those race the offline render and cut a filter's
// ring at a quantum they do not choose, so Chrome's raw output varies from run
// to run by up to 1.5e−3 in a tail; without them it is deterministic to 2e−8.
// Against that graph every bed measured agreed within 2e−6 a sample, so the
// pins hold at Jest's 5 digits.

import XCTest
@testable import AtelierKit

private func bed(_ events: [SoundEvent], _ seconds: Double, lead: Double = 0,
                 rate: Double = 48000, channels: Int = 2) -> [Float] {
    renderBed(events, seconds, leadSeconds: lead, sampleRate: rate, channels: channels)!.channelData(0)
}

private func assertPins(_ got: [Float], _ pins: [(Int, Double)], file: StaticString = #filePath, line: UInt = #line) {
    for (frame, want) in pins {
        assertClose(Double(got[frame]), want, 5, "frame \(frame)", file: file, line: line)
    }
}

private func peak(_ samples: [Float]) -> (value: Double, frame: Int) {
    var best = (value: 0.0, frame: 0)
    for (i, v) in samples.enumerated() where abs(Double(v)) > abs(best.value) { best = (Double(v), i) }
    return best
}

final class AudioRendererMeasuredTests: XCTestCase {
    func testAClickLandsAsChromeRendersItNoiseSnapOverASineBody() {
        let got = bed([SoundEvent(at: 0.05, voice: "click")], 0.2)
        XCTAssertEqual(got.count, 9600)
        XCTAssertEqual(got.firstIndex { $0 != 0 }, 2400)
        assertPins(got, [(2400, 0.015816321596503258), (2401, 0.04392702504992485), (2410, -0.04624741151928902),
                         (2430, 0.026109712198376656), (2460, 0.0417814664542675), (2500, -0.08335445076227188),
                         (2600, -0.058003753423690796)])
        let p = peak(got)
        XCTAssertEqual(p.frame, 2498)
        assertClose(p.value, -0.13695918023586273, 5)
    }

    /// The triangle is Chrome's band-limited one: two tables blended.
    func testABlipIsChromesBandLimitedTriangle() {
        let got = bed([SoundEvent(at: 0.0402, voice: "blip")], 0.2)
        XCTAssertEqual(got.firstIndex { $0 != 0 }, 1931)
        assertPins(got, [(1930, 0), (1931, 2.897412514357711e-6), (1940, 6.441959703806788e-5),
                         (1950, 2.3526336008217186e-4), (1960, -5.539327976293862e-4),
                         (2000, -0.031466610729694366), (2100, 0.0796511322259903)])
        let p = peak(got)
        XCTAssertEqual(p.frame, 2038)
        assertClose(p.value, -0.3241868019104004, 5)
    }

    /// An exponential sweep, started mid-quantum.
    func testAPopSweepsDownAsChromeRendersIt() {
        let got = bed([SoundEvent(at: 0.0311, voice: "pop")], 0.25)
        XCTAssertEqual(got.firstIndex { $0 != 0 }, 1494)
        assertPins(got, [(1500, 5.2021157898707315e-5), (1540, 0.0017784523079171777), (1600, 0.15250825881958008),
                         (2000, 0.05710417777299881), (3000, 0.018508801236748695), (5000, 2.33408049098216e-4)])
        assertClose(peak(got).value, 0.3308500349521637, 5)
    }

    /// 0.017 s × 48 kHz is 816.0000000000001: the second beep's oscillator
    /// starts on frame 817, and steps at 440 Hz for the 48 frames its quantum
    /// lends it — Chrome's start-quantum lag, reproduced.
    func testTwoBeepsOneStartingARoundingErrorPastAFrame() {
        let got = bed([SoundEvent(at: 0, voice: "beep", gain: 0.8), SoundEvent(at: 0.017, voice: "beep", gain: 0.85)], 0.2)
        assertPins(got, [(816, -0.05086721479892731), (817, -0.027714937925338745), (830, 0.19568946957588196),
                         (866, -0.1317804604768753), (900, 0.001613650587387383), (1032, -0.04257580265402794)])
        let p = peak(got)
        XCTAssertEqual(p.frame, 204)
        assertClose(p.value, -0.5481739044189453, 5)
    }

    /// A dense Défilé sweep rendered ahead of the AAC priming, as an export does.
    func testAScrubSweepWithItsLeadAsChromeRendersIt() {
        let score = [
            SoundEvent(at: 0, voice: "detent", gain: 0.8, rate: 0.84),
            SoundEvent(at: 0.061, voice: "detent", gain: 0.85, rate: 0.88),
            SoundEvent(at: 0.118, voice: "leg", gain: 1.2, rate: 0.92),
            SoundEvent(at: 0.19, voice: "detent", gain: 1.3, rate: 0.95),
            SoundEvent(at: 0.27, voice: "detent", gain: 1.4, rate: 1),
            SoundEvent(at: 0.37, voice: "leg", gain: 1.7, rate: 1.03),
            SoundEvent(at: 0.51, voice: "detent", gain: 1.5, rate: 1.07),
            SoundEvent(at: 0.69, voice: "detent", gain: 1.2, rate: 1.1),
            SoundEvent(at: 0.93, voice: "detent", gain: 1, rate: 1.14),
            SoundEvent(at: 1.27, voice: "leg", gain: 0.9, rate: 1.19),
            SoundEvent(at: 1.7, voice: "seat", gain: 1),
        ]
        let got = bed(score, 2.5, lead: 0.044)
        XCTAssertEqual(got.count, 120_000)
        assertPins(got, [(0, 0.005104829091578722), (100, -0.09699606150388718), (816, -0.03200557455420494),
                         (900, 0.10055754333734512), (3600, 0.0786244347691536), (3700, 0.23495809733867645),
                         (81000, -0.22051092982292175)])
        let p = peak(got)
        XCTAssertEqual(p.frame, 79808)
        assertClose(p.value, 0.6993494033813477, 5)
    }

    /// A mixed-in bed is rendered at the CLIP's rate and layout.
    func testAMonoBedAt44100() {
        let score = [
            SoundEvent(at: 0.2, voice: "pop"),
            SoundEvent(at: 0.45, voice: "blip", rate: 1.5),
            SoundEvent(at: 0.7, voice: "beep", rate: 0.5),
        ]
        let rendered = renderBed(score, 1, leadSeconds: 0.0478911, sampleRate: 44100, channels: 1)!
        XCTAssertEqual(rendered.numberOfChannels, 1)
        XCTAssertEqual(rendered.length, 44100)
        let got = rendered.channelData(0)
        XCTAssertEqual(got.firstIndex { $0 != 0 }, 6710)
        assertPins(got, [(6800, -0.0621090866625309), (17735, 3.3749613521649735e-6), (17800, -0.012174825184047222),
                         (28800, 2.8757372638210654e-4), (30000, 0.04013260081410408)])
        assertClose(peak(got).value, -0.34940269589424133, 5)
    }
}

final class AudioRendererRulesTests: XCTestCase {
    /// An oscillator starts on a plain ceil and at phase 0; a buffer source
    /// starts on the frame a rounding error past it names.
    func testAToneStartsOnTheNextFrameANoiseHitOnThisOne() {
        var tone = VoiceRenderer(sampleRate: 48000, length: 2000)
        tone.schedule(.tone(ToneSpec(freq: 880), when: 0.017))
        XCTAssertEqual(tone.frames[816], 0)
        XCTAssertEqual(tone.frames[817], 0)
        XCTAssertNotEqual(tone.frames[818], 0)

        var noise = VoiceRenderer(sampleRate: 48000, length: 2000)
        noise.schedule(.noise(NoiseSpec(freq: 2200), when: 0.017))
        XCTAssertEqual(noise.frames[815], 0)
        XCTAssertNotEqual(noise.frames[816], 0)
    }

    /// The browser throws on such a time; the kernel renders nothing and lives.
    func testAPartNoBedReachesRendersNothingAndNeverTraps() {
        var r = VoiceRenderer(sampleRate: 48000, length: 100)
        r.schedule(.tone(ToneSpec(freq: 440), when: .infinity))
        r.schedule(.tone(ToneSpec(freq: 440), when: -.infinity))
        r.schedule(.noise(NoiseSpec(freq: 2000), when: .nan))
        r.schedule(.noise(NoiseSpec(freq: 2000), when: -.infinity))
        XCTAssertEqual(r.frames, [Double](repeating: 0, count: 100))
    }

    func testTheSecondStrikeOfATypewriterComesThirtyMillisecondsLater() {
        var parts: [VoicePart] = []
        scheduleVoice(&parts, 1, "typewriter")
        XCTAssertEqual(parts.map(\.start), [1, 1.03])
    }

    func testALegIsCappedAtTheLoudestAVoiceMayPlay() {
        var parts: [VoicePart] = []
        scheduleVoice(&parts, 0, "leg", VoiceParams(gain: 2))
        guard case let .noise(noise, _) = parts[0] else { return XCTFail("a leg opens on its noise") }
        XCTAssertEqual(noise.gain, maxVoiceGain)
    }

    func testLevelAndPitchAreClampedToWhatTheVoicesWereDesignedAround() {
        var parts: [VoicePart] = []
        scheduleVoice(&parts, 0, "beep", VoiceParams(gain: 9, rate: 0))
        guard case let .tone(tone, _) = parts[0] else { return XCTFail("a beep is a tone") }
        XCTAssertEqual(tone.gain, maxVoiceGain)
        assertClose(tone.freq, 880 * 0.05, 9)
        var silent: [VoicePart] = []
        scheduleVoice(&silent, 0, "beep", VoiceParams(gain: .nan))
        guard case let .tone(quiet, _) = silent[0] else { return XCTFail("a beep is a tone") }
        XCTAssertEqual(quiet.gain, 0)
    }
}

final class AudioRenderBedFormatTests: XCTestCase {
    func testNothingToPlayIsNoBed() {
        XCTAssertNil(renderBed([], 2))
        XCTAssertNil(renderBed([SoundEvent(at: 3, voice: "tick")], 2))
        XCTAssertNil(renderBed([SoundEvent(at: 0, voice: "tick")], 0))
        XCTAssertNil(renderBed([SoundEvent(at: 0, voice: "tick")], .nan))
        XCTAssertNil(renderBed([SoundEvent(at: 0, voice: "tick")], .infinity))
    }

    func testTheFormatIsTheOneAskedForEveryChannelTheSameSignal() {
        let stereo = renderBed([SoundEvent(at: 0.01, voice: "wood")], 0.1)!
        XCTAssertEqual(stereo.sampleRate, bedSampleRate)
        XCTAssertEqual(stereo.numberOfChannels, 2)
        XCTAssertEqual(stereo.length, 4800)
        XCTAssertEqual(stereo.channelData(0), stereo.channelData(1))
        XCTAssertEqual(renderBed([SoundEvent(at: 0, voice: "wood")], 0.10001, sampleRate: 44100, channels: 1)!.length, 4411)
        XCTAssertEqual(renderBed([SoundEvent(at: 0, voice: "wood")], 0.1, channels: 0)!.numberOfChannels, 2)
        XCTAssertEqual(renderBed([SoundEvent(at: 0, voice: "wood")], 0.1, channels: 6)!.numberOfChannels, 2)
        XCTAssertEqual(renderBed([SoundEvent(at: 0, voice: "wood")], 0.1, sampleRate: 0)!.sampleRate, bedSampleRate)
    }

    func testTheLeadRendersEverySoundThatMuchEarlyNeverBeforeZero() {
        let led = renderBed([SoundEvent(at: 0.5, voice: "beep")], 1, leadSeconds: 0.25)!
        let plain = renderBed([SoundEvent(at: 0.25, voice: "beep")], 1)!
        XCTAssertEqual(led, plain)
        let early = renderBed([SoundEvent(at: 0.01, voice: "tick")], 0.2, leadSeconds: aacPrimingSeconds(48000))!
        XCTAssertEqual(early, renderBed([SoundEvent(at: 0, voice: "tick")], 0.2)!)
    }

    func testTheSamePieceRendersTheSameBedAndTwoHitsNeverShareOneTexture() {
        let score = [SoundEvent(at: 0.02, voice: "tick"), SoundEvent(at: 0.12, voice: "tick")]
        let a = renderBed(score, 0.2)!.channelData(0)
        XCTAssertEqual(renderBed(score, 0.2)!.channelData(0), a)
        XCTAssertNotEqual(Array(a[960..<2400]), Array(a[5760..<7200]))
    }

    func testAScoreThatWouldClipIsHeldAtTheCeilingAsAWhole() {
        let loud = Array(repeating: SoundEvent(at: 0.05, voice: "seat", gain: 2), count: 6)
        let got = renderBed(loud, 0.4)!.channelData(0)
        assertClose(abs(peak(got).value), bedCeiling, 6)
        let quiet = renderBed([SoundEvent(at: 0.05, voice: "seat", gain: 0.2)], 0.4)!.channelData(0)
        XCTAssertLessThan(abs(peak(quiet).value), bedCeiling)
    }
}
