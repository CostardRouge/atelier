// Pins `LibraryWords.swift` — the words the web's Library components print,
// which have no spec of their own there (`AssetSidebar.tsx`, `DayPicker.tsx`,
// `WinnowScopeGrid.tsx`, `WinnowLightbox.tsx`).

import Foundation
import XCTest
@testable import AtelierKit

private func wordsRef(_ name: String, _ size: Int) -> SavedMediaRef {
    SavedMediaRef(name: name, size: size, lastModified: 0)
}

private let utc = TimeZone(identifier: "UTC")!

private func cadence(_ scale: Double, basis: TimeScaleReading.Basis, media: Double?, capture: Double?) -> TimeScaleReading {
    TimeScaleReading(scale: scale, basis: basis, mediaFps: media, captureFps: capture, snapped: false, spanSeconds: 10, samples: 100)
}

final class LibraryAssetWordsTests: XCTestCase {
    func testNamesAKindTheWayTheChipDoes() {
        XCTAssertEqual(assetKindLabel(.videoTelemetry), "video+srt")
        XCTAssertEqual(assetKindLabel(.telemetry), "srt")
        XCTAssertEqual(assetKindLabel(.photo), "photo")
        XCTAssertEqual(assetKindLabel(.video), "video")
        XCTAssertEqual(assetKindLabel(.other), "other")
    }

    func testSaysReadingUntilTheCoverHasBeenRead() {
        let asset = buildAssets([wordsRef("A.JPG", 10)])[0]
        XCTAssertEqual(assetFactsLine(asset, nil), "reading…")
        XCTAssertEqual(assetFactsLine(asset, CoverFacts(status: .pending, isVideo: false)), "reading…")
    }

    func testSaysEveryFileOfTheCaptureOnThePicturesType() {
        let asset = buildAssets([wordsRef("DJI_0101.JPG", 683_000), wordsRef("DJI_0101.DNG", 20_000_000)])[0]
        let cover = CoverFacts(status: .ready, isVideo: false, width: 4000, height: 3000, imageType: "JPEG")
        XCTAssertEqual(assetFactsLine(asset, cover), "4000×3000 · JPEG + DNG · 20.7 MB")
    }

    func testGivesAClipItsLengthAndTheRateItWasSHOTAtOnlyWhenTheLogWasMeasured() {
        let asset = buildAssets([wordsRef("DJI_0001.MP4", 1_500_000), wordsRef("DJI_0001.SRT", 0)])[0]
        var cover = CoverFacts(status: .ready, isVideo: true, width: 3840, height: 2160, duration: 63)
        XCTAssertEqual(assetFactsLine(asset, cover), "3840×2160 · 1:03 · 1.5 MB")
        cover.timing = cadence(0.25, basis: .timestamps, media: 30, capture: 120)
        XCTAssertEqual(assetFactsLine(asset, cover), "3840×2160 · 1:03 · 120 fps · 1.5 MB")
    }

    func testWritesARateAsJavaScriptDoesAndNothingForAnUnmeasuredOne() {
        XCTAssertNil(coverFpsText(nil))
        XCTAssertEqual(coverFpsText(cadence(1, basis: .none, media: 29.97, capture: nil)), "29.97 fps")
        XCTAssertEqual(coverFpsText(cadence(1, basis: .none, media: 30, capture: nil)), "30 fps")
        XCTAssertNil(coverFpsText(cadence(1, basis: .none, media: nil, capture: nil)))
    }

    func testChipsARawBesideItsPictureAndNothingElse() {
        XCTAssertEqual(libraryPairTag(buildAssets([wordsRef("A.JPG", 1), wordsRef("A.DNG", 1)])[0].parts), "+DNG")
        XCTAssertEqual(libraryPairTag(buildAssets([wordsRef("B.ARW", 1), wordsRef("B.JPG", 1)])[0].parts), "+ARW")
        XCTAssertNil(libraryPairTag(buildAssets([wordsRef("C.JPG", 1), wordsRef("C.HIF", 1)])[0].parts))
        XCTAssertNil(libraryPairTag(buildAssets([wordsRef("D.JPG", 1)])[0].parts))
    }

    func testSaysACadenceItCouldNotMeasureRatherThanClaimingOne() {
        XCTAssertEqual(cadenceSentence(nil, nil), "")
        XCTAssertEqual(cadenceSentence(cadence(1, basis: .none, media: 30, capture: nil), "30 fps"),
                       "plays at 30 fps — shooting cadence not measurable")
        XCTAssertEqual(cadenceSentence(cadence(1, basis: .none, media: nil, capture: nil), nil), "")
        XCTAssertEqual(cadenceSentence(cadence(0.25, basis: .timestamps, media: 30, capture: 120), "120 fps"),
                       "4× slow motion · 120 → 30 fps")
        XCTAssertEqual(cadenceSentence(cadence(1, basis: .timestamps, media: 60, capture: 60), "60 fps"),
                       "real time · 60 fps")
    }

    func testOffersTheInstancesTwoHalvesInWinnowsOwnWordsBothFirst() {
        XCTAssertEqual(libraryHalves.map(\.label), ["All", "Incoming", "Gallery"])
        XCTAssertEqual(libraryHalves.map(\.half), [nil, .incoming, .final])
    }
}

final class LibraryStepperWordsTests: XCTestCase {
    func testNamesADayWithItsWeekday() {
        XCTAssertEqual(libraryDayName("2026-02-12"), "Thu 12 Feb 2026")
    }

    func testWritesASpanShortInsideAMonthAndWholeAcrossTwo() {
        XCTAssertEqual(spanLabel(DaySpan(from: "2025-03-25", to: "2025-03-27")), "25 → 27 Mar 2025")
        XCTAssertEqual(spanLabel(DaySpan(from: "2025-03-30", to: "2025-04-02")), "30 Mar 2025 → 2 Apr 2025")
    }

    func testSaysWhereTheViewSitsAgainstTheToolsDayOrAgainstToday() {
        let piece = DaySpan(from: "2026-02-12", to: "2026-02-12")
        XCTAssertEqual(stepperWhere(day: "2026-02-12", anchor: piece, publisher: "Trips", overridden: false, today: "2026-09-26"),
                       "open in Trips")
        XCTAssertEqual(stepperWhere(day: "2026-02-11", anchor: piece, publisher: "Trips", overridden: true, today: "2026-09-26"),
                       "the day before")
        XCTAssertEqual(stepperWhere(day: "2026-09-26", anchor: nil, publisher: nil, overridden: false, today: "2026-09-26"), "today")
        XCTAssertEqual(stepperWhere(day: "2026-09-25", anchor: nil, publisher: nil, overridden: false, today: "2026-09-26"), "yesterday")
    }

    func testCountsWhatTheDayHoldsOrSaysWhyItCannot() {
        XCTAssertEqual(stepperCount(asking: true, count: 4), "asking…")
        XCTAssertEqual(stepperCount(asking: false, count: nil), "no answer")
        XCTAssertEqual(stepperCount(asking: false, count: 0), "nothing here")
        XCTAssertEqual(stepperCount(asking: false, count: 1), "1 file")
        XCTAssertEqual(stepperCount(asking: false, count: 3), "3 files")
    }

    func testTheMonthsLineSaysWhatItWaitsForTheDayUnderThePointerOrTheWholeMonth() {
        let days = ["2026-02-01", "2026-02-02", "2026-02-03"]
        let strip = densityStrip(days, ["2026-02-01": 3, "2026-02-03": 4])
        let empty = densityStrip(days, [:])
        let host = "winnow.example"
        XCTAssertEqual(monthStripLine(host: host, monthKey: "2026-02", busy: true, failed: false, hovered: nil, hoveredCount: 0, strip: strip),
                       "asking winnow.example…")
        XCTAssertEqual(monthStripLine(host: host, monthKey: "2026-02", busy: false, failed: false, hovered: "2026-02-03", hoveredCount: 4, strip: strip),
                       "3 Feb 2026 · 4 files")
        XCTAssertEqual(monthStripLine(host: host, monthKey: "2026-02", busy: false, failed: false, hovered: "2026-02-02", hoveredCount: 0, strip: strip),
                       "2 Feb 2026 · nothing")
        XCTAssertEqual(monthStripLine(host: host, monthKey: "2026-02", busy: false, failed: true, hovered: nil, hoveredCount: 0, strip: strip),
                       "could not ask winnow.example")
        XCTAssertEqual(monthStripLine(host: host, monthKey: "2026-02", busy: false, failed: false, hovered: nil, hoveredCount: 0, strip: empty),
                       "nothing in \(monthLabel("2026-02"))")
        XCTAssertEqual(monthStripLine(host: host, monthKey: "2026-02", busy: false, failed: false, hovered: nil, hoveredCount: 0, strip: strip),
                       "7 files · busiest day 4")
    }

    func testSaysAnEmptySpanInTheInstancesName() {
        XCTAssertEqual(instanceEmptyLine(host: "winnow.example", span: DaySpan(from: "2026-02-12", to: "2026-02-12")),
                       "winnow.example holds nothing shot on 2026-02-12.")
        XCTAssertEqual(instanceEmptyLine(host: "winnow.example", span: DaySpan(from: "2026-02-12", to: "2026-02-14")),
                       "winnow.example holds nothing shot from 2026-02-12 to 2026-02-14.")
    }
}

final class LibraryRowWordsTests: XCTestCase {
    func testSaysWhenAndHowBigARowIsInTheCamerasOwnClock() {
        let photo = WinnowAssetRow(id: 1, filename: "DJI_0101.JPG", mediaType: .photo, capturedAt: "2026-02-12T09:41:07+00:00",
                                   width: 4000, height: 3000, fileSize: 5_400_000)
        XCTAssertEqual(rowFactsLine(photo, timeZone: utc), "12 Feb 2026 · 09:41 · 4000×3000 · 5.4 MB")
        let clip = WinnowAssetRow(id: 2, filename: "DJI_0001.MP4", mediaType: .video, capturedAt: "2026-02-12T18:02:00+00:00",
                                  width: 3840, height: 2160, durationS: 63, fileSize: 1_500_000_000, hasTelemetry: true)
        XCTAssertEqual(rowFactsLine(clip, timeZone: utc), "12 Feb 2026 · 18:02 · 3840×2160 · 1:03 · 1.5 GB · flight log")
    }

    func testSaysARowHasNoCaptureTimeRatherThanInventingOne() {
        let row = WinnowAssetRow(id: 3, filename: "X.JPG", mediaType: .photo)
        XCTAssertEqual(rowFactsLine(row, timeZone: utc), "no capture time")
    }

    func testPutsTheBodyAndTheGlassOnTheExposureLine() {
        let row = WinnowAssetRow(id: 4, filename: "DSC0001.ARW", mediaType: .photo, cameraModel: "ILCE-7CM2", lens: "FE 35mm F1.8",
                                 iso: 100, aperture: 1.8, focalLength: 35)
        let line = rowCameraLine(row, timeZone: utc)
        XCTAssertTrue(line.hasPrefix("ILCE-7CM2 · FE 35mm F1.8 · 35 mm"), line)
        XCTAssertTrue(line.hasSuffix("ISO 100"), line)
        XCTAssertEqual(rowCameraLine(WinnowAssetRow(id: 5, filename: "Y.JPG"), timeZone: utc), "")
    }

    func testTitlesTheCardOfADayWithNothingToShow() {
        XCTAssertEqual(placeholderTitle(DaySpan(from: "2026-02-12", to: "2026-02-12")), "Thu 12 Feb 2026")
        XCTAssertEqual(placeholderTitle(DaySpan(from: "2026-02-12", to: "2026-02-14")), "12 Feb 2026 → 14 Feb 2026")
    }

    func testNamesTheNearestDayEachWayOrWhyThereIsNone() {
        let host = "winnow.example"
        XCTAssertEqual(edgeCardWords(.after, .day(date: "2026-02-13", count: 1), host: host),
                       EdgeCardWords(title: "Fri 13 Feb 2026", facts: "the next day with media", line: "→ Fri 13 Feb 2026 · 1 file"))
        XCTAssertEqual(edgeCardWords(.before, .day(date: "2026-02-10", count: 12), host: host).line,
                       "← Tue 10 Feb 2026 · 12 files")
        XCTAssertEqual(edgeCardWords(.before, .asking, host: host),
                       EdgeCardWords(title: "The previous day", facts: "asking…", line: "looking for the previous day with media…"))
        XCTAssertEqual(edgeCardWords(.after, .none, host: host),
                       EdgeCardWords(title: "No next day", facts: "the edge of what it holds",
                                     line: "winnow.example holds nothing after this day"))
        XCTAssertEqual(edgeCardWords(.before, .failed, host: host),
                       EdgeCardWords(title: "The previous day", facts: "no answer", line: "could not ask winnow.example"))
    }
}
