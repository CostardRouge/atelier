// The Studio Export tab's words and numbers (`Projects/StudioExport.swift`),
// pinned from the web's `StudioEditor.tsx` — which has no spec of its own for
// them — plus the two sentences the native panel adds.

import XCTest
@testable import AtelierKit

private func studioVariant(_ change: (inout ExportVariant) -> Void = { _ in }) -> ExportVariant {
    var v = createVariant(id: "v")
    change(&v)
    return v
}

final class StudioExportFrameTests: XCTestCase {
    func testTheLargestFrameIsTheBiggestAreaAnyVariantWrites() {
        let plain = studioVariant()
        let reel = studioVariant { $0.aspectId = "9:16"; $0.resolution = .shortSide(1080) }
        XCTAssertEqual(largestVariantFrame([reel, plain], 3840, 2160), Size(3840, 2160))
        XCTAssertEqual(largestVariantFrame([reel], 3840, 2160), Size(1080, 1920))
    }

    func testTheFirstOfTwoEqualFramesIsKept() {
        let a = studioVariant { $0.id = "a"; $0.aspectId = "1:1" }
        let b = studioVariant { $0.id = "b"; $0.aspectId = "1:1"; $0.overlays = false }
        XCTAssertEqual(largestVariantFrame([a, b], 1920, 1080), Size(1080, 1080))
    }

    func testNoSizeOrNoVariantIsNoFrame() {
        XCTAssertNil(largestVariantFrame([studioVariant()], 0, 1080))
        XCTAssertNil(largestVariantFrame([], 1920, 1080))
    }
}

final class StudioExportMenuTests: XCTestCase {
    func testTheFormatMenuReadsTheWebsLabels() {
        XCTAssertEqual(variantFormatLabel("source"), "Source frame")
        XCTAssertEqual(variantFormatLabel("9:16"), "9:16 — Reels · TikTok · Shorts")
        XCTAssertEqual(variantFormatLabel("21:9"), "21:9")
        let ids = variantFormatChoices()
        XCTAssertEqual(ids.first, "source")
        XCTAssertEqual(Array(ids.dropFirst()), aspectPresets.map(\.id))
        XCTAssertEqual(variantFormatChoices(current: "21:9").last, "21:9")
        XCTAssertEqual(variantFormatChoices(current: "9:16").count, aspectPresets.count + 1)
    }

    func testTheResolutionMenuKeepsAStoredShortSide() {
        XCTAssertEqual(variantResolutionChoices(), [.source, .shortSide(1080), .shortSide(720)])
        XCTAssertEqual(variantResolutionChoices(current: .shortSide(480)).last, .shortSide(480))
        XCTAssertEqual(variantResolutionChoices(current: .shortSide(720)).count, 3)
        XCTAssertEqual(variantResolutionLabel(.source), "Source")
        XCTAssertEqual(variantResolutionLabel(.shortSide(1080)), "1080p")
    }

    func testTheFrameRateMenuNamesTheSourceCadenceWhenKnown() {
        XCTAssertEqual(frameRateSourceLabel(29.97), "Source (29.97 fps)")
        XCTAssertEqual(frameRateSourceLabel(30), "Source (30 fps)")
        XCTAssertEqual(frameRateSourceLabel(nil), "Source")
        let menu = frameRateMenu()
        XCTAssertEqual(menu.first, .source)
        XCTAssertEqual(menu.count, frameRateChoices.count + 1)
        XCTAssertEqual(frameRateMenu(current: .fps(15)).last, .fps(15))
    }

    func testASpeedRowNamesTheRealtimeOne() {
        XCTAssertEqual(speedOptionLabel(1, realtimeRate: 1), "Normal")
        XCTAssertEqual(speedOptionLabel(2, realtimeRate: 1), "2×")
        XCTAssertEqual(speedOptionLabel(0.25, realtimeRate: 4), "0.25×")
        XCTAssertEqual(speedOptionLabel(4, realtimeRate: 4), "4× — real time")
        // Normal is never called real time, even over a real-time clip.
        XCTAssertEqual(speedOptionLabel(1, realtimeRate: 1), "Normal")
    }
}

final class StudioExportHintTests: XCTestCase {
    func testAShortfallSaysWhatTheSourceDelivers() {
        let short = ResolutionShortfall(asked: 1080, delivered: 720)
        XCTAssertEqual(shortfallHint(short, renderingFromProxy: false), "1080p was asked for; this source delivers 720p.")
        XCTAssertEqual(shortfallHint(short, renderingFromProxy: true),
                       "1080p was asked for; this source delivers 720p. Turn off “From proxy” to export from the original.")
    }

    func testAFrameRateAboveTheSourceSaysFramesAreDuplicated() {
        XCTAssertEqual(frameRateHint(.fps(60), sourceFps: 30),
                       "60 fps from 30 — frames are duplicated, not interpolated: no new motion.")
        XCTAssertNil(frameRateHint(.fps(24), sourceFps: 30))
        XCTAssertNil(frameRateHint(.fps(30), sourceFps: 30))
        XCTAssertNil(frameRateHint(.source, sourceFps: 30))
        XCTAssertNil(frameRateHint(.fps(60), sourceFps: nil))
    }

    func testARetimedRowSaysItsLengthAndItsSilence() {
        XCTAssertNil(speedHint(1, duration: 40))
        XCTAssertEqual(speedHint(2, duration: 40),
                       "2× speed — 0:20 instead of 0:40, delivered without audio: a copied track would drift against a re-timed picture.")
        XCTAssertEqual(speedHint(0.5, duration: 0),
                       "0.5× speed, delivered without audio: a copied track would drift against a re-timed picture.")
        // An out-of-range speed is the clip's own: no hint.
        XCTAssertNil(speedHint(64, duration: 40))
    }

    func testTheFromProxyRowSaysWhichFileLeaves() {
        XCTAssertEqual(fromProxyHint(sourceId: "winnow.example", proxyHeight: 1080, fetchesOriginal: true),
                       "You are editing on winnow.example's proxy (1080p) — the export fetches the original first, so the deliverables are full quality.")
        XCTAssertEqual(fromProxyHint(sourceId: "winnow.example", proxyHeight: nil, fetchesOriginal: false),
                       "You are editing on winnow.example's proxy — and delivering from it: faster, nothing large crosses the network, proxy quality.")
    }

    func testAProxyStillsDeliversHintLeadsWithItsReason() {
        let tail = "You are editing on w.example’s proxy: the full-size original is fetched only where the proxy could not fill the frame your variants ask for, and kept for this session. A RAW is reached only through the render inside it, measured first — develop it on its RAW for the sensor itself."
        XCTAssertEqual(proxyDeliversHint(sourceId: "w.example", reason: "the proxy would be upscaled ×1.25", measured: true),
                       "the proxy would be upscaled ×1.25. " + tail)
        XCTAssertEqual(proxyDeliversHint(sourceId: "w.example", reason: nil, measured: true), tail)
        XCTAssertEqual(proxyDeliversHint(sourceId: "w.example", reason: nil, measured: false),
                       "Measured once the picture is decoded. " + tail)
    }
}

final class StudioExportRunWordsTests: XCTestCase {
    func testTheButtonCountsWhatItWillWrite() {
        XCTAssertEqual(studioExportVerb(.photo, 1), "Export JPEG")
        XCTAssertEqual(studioExportVerb(.photo, 3), "Export 3 JPEGs")
        XCTAssertEqual(studioExportVerb(.video, 1), "Export MP4")
        XCTAssertEqual(studioExportVerb(.video, 2), "Export 2 MP4s")
        XCTAssertEqual(studioExportHelp(.photo), "Render every variant as a JPEG, one after the other")
        XCTAssertEqual(studioExportHelp(.video), "Render every variant (H.264 MP4), one after the other")
    }

    func testTheLineOverTheBar() {
        XCTAssertEqual(studioExportProgressLine(fetchingFrom: "w.example", fetching: true, index: 1, total: 3, ratio: 0.4),
                       "Fetching the original from w.example… ")
        XCTAssertEqual(studioExportProgressLine(fetchingFrom: nil, fetching: true, index: nil, total: nil, ratio: 0),
                       "Fetching the original from the source… ")
        XCTAssertEqual(studioExportProgressLine(fetchingFrom: nil, fetching: false, index: 2, total: 3, ratio: 0.455),
                       "Variant 2/3 · 46%")
        XCTAssertEqual(studioExportProgressLine(fetchingFrom: nil, fetching: false, index: 1, total: 1, ratio: 0.5),
                       "Exporting… 50%")
        XCTAssertEqual(studioExportProgressLine(fetchingFrom: nil, fetching: false, index: nil, total: nil, ratio: 1),
                       "Exporting… 100%")
    }

    func testACancelledRunSaysWhatItKept() {
        XCTAssertEqual(studioExportCancelledNote(written: 0, total: 3), "Export cancelled — nothing was written.")
        XCTAssertEqual(studioExportCancelledNote(written: 1, total: 3),
                       "Export cancelled — 1 variant of 3 written, kept where it landed.")
        XCTAssertEqual(studioExportCancelledNote(written: 2, total: 3),
                       "Export cancelled — 2 variants of 3 written, kept where they landed.")
    }
}
