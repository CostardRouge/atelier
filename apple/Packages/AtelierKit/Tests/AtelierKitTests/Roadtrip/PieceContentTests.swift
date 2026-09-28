// The piece editor's Content tab, its pure half (`Roadtrip/PieceContent.swift`).
// The web keeps these rules inside `ContentTab.tsx`, `SlideDelivery.tsx` and
// `CameraPanel.tsx` with no spec of their own, so this one pins what the
// panel promises: the real sentence for every way a slide goes out, what each
// choice costs, the day of the trip and the picture's own date offered, every
// counter and time mode as its real line or its reason, and the camera
// credit's words, order, alias, place and tiles.

import XCTest
@testable import AtelierKit

private func trip(_ change: (inout TripDoc) -> Void = { _ in }) -> TripDoc {
    var doc = createTripDoc("Australia", "2025-03-01", "2026-01-04")
    change(&doc)
    return doc
}

private func post(_ date: IsoDate = "2025-03-27", _ end: IsoDate? = nil) -> TripPost {
    createTripPost(.photo, date, "Cliffs", endDate: end)
}

private let kalbarri = trip { $0.stages = [createTripStage("Kalbarri", "WA", "2025-03-25", "2025-03-28")] }

final class PieceContentDeliveryTests: XCTestCase {
    func testSaysTheRealSentenceForEveryReason() {
        XCTAssertEqual(reasonSentence(.animated, 4, 2),
                       "This slide animates, so it goes out as a 4.0s video at 2×, without sound.")
        XCTAssertEqual(reasonSentence(.moving, 2.5), "Its picture is a clip, so it goes out as 2.5s of video.")
        XCTAssertEqual(reasonSentence(.moving, 3, 0.25),
                       "Its picture is a clip, so it goes out as 3.0s of video at 0.25×, without sound.")
        XCTAssertEqual(reasonSentence(.forcedVideo, 3, 2), "A still picture, held for 3.0s of video because you asked.")
        XCTAssertEqual(reasonSentence(.settled, 3),
                       "This slide animates, but you asked for an image: the badge is drawn settled, as it comes to rest.")
        XCTAssertEqual(reasonSentence(.frozen, 3),
                       "Its picture is a clip, but you asked for an image: the frame you chose is what goes out.")
        XCTAssertEqual(reasonSentence(.plain, 3), "A still picture, delivered as one.")
    }

    func testPrintsTheLengthAsToFixedDoesATieGoingUp() {
        XCTAssertEqual(reasonSentence(.forcedVideo, 2.25), "A still picture, held for 2.3s of video because you asked.")
    }

    func testAChoiceSaysWhatItWouldCostNeverItsOwnName() {
        // A still, nothing animated.
        let still = slideMediumChoices.map { c in
            slideMediumChoiceHint(c.id, resolveSlideMedium(c.id, false, nil).reason,
                                  resolveSlideMedium(c.id, false, nil).medium)
        }
        XCTAssertEqual(still, ["image", nil, "a held card"])
        // An animated hook.
        let animated = slideMediumChoices.map { c in
            slideMediumChoiceHint(c.id, resolveSlideMedium(c.id, true, nil).reason,
                                  resolveSlideMedium(c.id, true, nil).medium)
        }
        XCTAssertEqual(animated, ["video", "settled", nil])
        // A clip.
        let clip = slideMediumChoices.map { c in
            slideMediumChoiceHint(c.id, resolveSlideMedium(c.id, false, "DJI_0001.MP4").reason,
                                  resolveSlideMedium(c.id, false, "DJI_0001.MP4").medium)
        }
        XCTAssertEqual(clip, ["video", "one frame", nil])
    }

    func testOffersTheThreeChoicesInOrder() {
        XCTAssertEqual(slideMediumChoices.map(\.label), ["Auto", "Image", "Video"])
        XCTAssertEqual(slideMediumChoices.map(\.id), [.auto, .image, .video])
    }

    func testOnScreenSaysWhatCapsAClipAndWhatAStillIsHeldFor() {
        XCTAssertEqual(onScreenHint(.image, clipSeconds: 0, ceiling: maxHookSeconds, speed: 1),
                       "How long this picture holds the screen when the piece plays.")
        XCTAssertNil(onScreenHint(.video, clipSeconds: 0, ceiling: maxHookSeconds, speed: 1))
        XCTAssertNil(onScreenHint(.video, clipSeconds: 60, ceiling: maxHookSeconds, speed: 1))
        XCTAssertEqual(onScreenHint(.video, clipSeconds: 4, ceiling: 3.5, speed: 1),
                       "At most 3.5s of the clip is left after its in point.")
        XCTAssertEqual(onScreenHint(.video, clipSeconds: 4, ceiling: 1.75, speed: 2),
                       "At most 1.8s of the clip is left after its in point at 2×.")
    }

    func testARetimedClipSaysItGoesOutSilent() {
        XCTAssertNil(clipSpeedHint(1))
        XCTAssertEqual(clipSpeedHint(0.5), "A re-timed clip goes out without sound.")
        XCTAssertEqual(clipSpeeds.map(clipSpeedLabel), ["0.25×", "0.5×", "1×", "2×", "4×"])
    }
}

final class PieceContentDayTests: XCTestCase {
    func testPlacesTheDayInTheTrip() {
        XCTAssertEqual(pieceDayOfTrip(trip(), post()), "day 27 / 310")
        XCTAssertEqual(pieceDayOfTrip(trip(), post("2025-03-27", "2025-03-29")), "day 27–29 / 310")
        let reversed = trip {
            $0.startDate = "2026-01-04"
            $0.endDate = "2025-03-01"
        }
        XCTAssertEqual(pieceDayOfTrip(reversed, post()), "outside the trip")
    }

    func testNamesWhichRungDatedThePicture() {
        XCTAssertEqual(captureSourceWords(CaptureDate(date: "2025-03-27", source: .exif)), "(the camera’s own record)")
        XCTAssertEqual(captureSourceWords(CaptureDate(date: "2025-03-27", source: .source, via: "winnow.example")),
                       "(the capture time winnow.example read at ingest)")
        XCTAssertEqual(captureSourceWords(CaptureDate(date: "2025-03-27", source: .source)),
                       "(the capture time the source read at ingest)")
        XCTAssertEqual(captureSourceWords(CaptureDate(date: "2025-03-27", source: .file)),
                       "(the file’s date — a copy or an export rewrites it)")
    }

    func testOffersThePicturesDayAndCallsOutOneOutsideTheTrip() throws {
        XCTAssertNil(captureOffer(trip(), post(), nil))
        let same = try XCTUnwrap(captureOffer(trip(), post(), CaptureDate(date: "2025-03-27", source: .exif)))
        XCTAssertFalse(same.elsewhere)
        XCTAssertFalse(same.outsideTrip)
        XCTAssertEqual(same.dateText, "27 Mar 2025")
        let brittany = try XCTUnwrap(captureOffer(trip(), post(), CaptureDate(date: "2026-07-14", source: .file)))
        XCTAssertTrue(brittany.elsewhere)
        XCTAssertTrue(brittany.outsideTrip)
        XCTAssertEqual(brittany.date, "2026-07-14")
        XCTAssertEqual(brittany.sourceWords, "(the file’s date — a copy or an export rewrites it)")
    }

    func testTheMarkerReadsTheStagesNameOrSaysThereIsNone() {
        XCTAssertEqual(pieceMarkerPlace(kalbarri, post()), "Kalbarri")
        XCTAssertNil(pieceMarkerPlace(trip(), post()))
        let blank = trip { $0.stages = [createTripStage("  ", "WA", "2025-03-25", "2025-03-28")] }
        XCTAssertNil(pieceMarkerPlace(blank, post()))
        XCTAssertEqual(markerHint("Kalbarri"), "The place reads “Kalbarri”.")
        XCTAssertEqual(markerHint(nil),
                       "No stage covers this day, so there is no place to mark — add one on the Overview.")
    }
}

final class PieceContentModesTests: XCTestCase {
    func testEveryCounterModeIsItsRealLineOrItsReason() {
        let choices = pieceCounterChoices(trip(), post())
        XCTAssertEqual(choices.map(\.id), [.day, .dayRange, .stageDay, .stageLength])
        XCTAssertEqual(choices[0].text, "Day · 27 · of 310")
        XCTAssertEqual(choices[0].menuLabel, "Day of trip · Day · 27 · of 310")
        XCTAssertNil(choices[2].text)
        XCTAssertEqual(choices[2].menuLabel, "Day at the place · No stage covers 27 Mar 2025.")
    }

    func testTheChosenCounterRepeatsItsLineOrSaysWhatIsCountedMeanwhile() {
        let plain = pieceCounterChoices(trip(), post())
        XCTAssertEqual(pieceCounterHint(plain, .day), .line("Day · 27 · of 310"))
        XCTAssertEqual(pieceCounterHint(plain, .stageDay),
                       .reason("No stage covers 27 Mar 2025. Stages are edited on the trip’s Overview; the day of the trip is counted meanwhile."))
        XCTAssertEqual(pieceCounterHint(plain, .dayRange),
                       .reason("This piece tells a single day — give it an end date to count a range. It counts the single day above meanwhile."))
        let there = pieceCounterChoices(kalbarri, post())
        XCTAssertEqual(pieceCounterHint(there, .stageDay), .line("Kalbarri · 3 · of 4"))
    }

    func testAReversedTripSaysSoForEveryCounterMode() {
        let reversed = trip {
            $0.startDate = "2026-01-04"
            $0.endDate = "2025-03-01"
        }
        let choices = pieceCounterChoices(reversed, post())
        XCTAssertTrue(choices.allSatisfy { $0.text == nil })
        XCTAssertEqual(choices[0].otherwise, "The trip’s own dates are the wrong way round.")
    }

    func testEveryTimeModeIsItsRealLineOnTheReadingDay() {
        let choices = pieceTimeChoices("2025-03-27", "2025-04-03", defaultTimeAgoWords)
        XCTAssertEqual(choices.map(\.id), timeAgoModes.map(\.id))
        let byId = Dictionary(uniqueKeysWithValues: choices.map { ($0.id, $0) })
        XCTAssertNil(byId[.off]?.text)
        XCTAssertEqual(byId[.off]?.menuLabel, "Off")
        XCTAssertEqual(byId[.off]?.otherwise, "no line")
        XCTAssertEqual(byId[.daysAgo]?.text, "7 days ago")
        XCTAssertEqual(byId[.daysAgo]?.menuLabel, "Days · 7 days ago")
        XCTAssertEqual(byId[.weeksAgo]?.text, "1 week ago")
        XCTAssertNil(byId[.anniversary]?.text)
        XCTAssertEqual(byId[.anniversary]?.menuLabel, "Anniversary")
        XCTAssertEqual(byId[.anniversary]?.otherwise, "nothing true to say on that day")
        XCTAssertEqual(byId[.since]?.text, "since 27 Mar 2025")
    }

    func testTheChosenTimeModeQuotesItsLineOrSaysWhyItIsLeftOut() {
        let week = pieceTimeChoices("2025-03-27", "2025-04-03", defaultTimeAgoWords)
        XCTAssertEqual(pieceTimeHint(week, .daysAgo), .line("“7 days ago”"))
        XCTAssertEqual(pieceTimeHint(week, .off),
                       .reason("No line about when. The trip’s name is on the badge either way."))
        XCTAssertEqual(pieceTimeHint(week, .anniversary),
                       .reason("Not the anniversary on that day, so the line is left out. Nothing claims a date it is not."))
        let before = pieceTimeChoices("2025-03-27", "2025-03-20", defaultTimeAgoWords)
        XCTAssertEqual(pieceTimeHint(before, .daysAgo),
                       .reason("Nothing true to say about that gap yet, so the line is left out."))
        XCTAssertEqual(pieceTimeHint(before, .since), .line("“since 27 Mar 2025”"))
    }

    func testTheRealAnniversaryIsTheOnlyOneOffered() {
        let choices = pieceTimeChoices("2025-03-27", "2026-03-27", defaultTimeAgoWords)
        XCTAssertEqual(pieceTimeHint(choices, .anniversary), .line("“1 year ago today”"))
    }
}

final class PieceContentCameraTests: XCTestCase {
    func testTheCreditSaysTheHandWrittenLineTheRealOneOrWhyThereIsNone() {
        XCTAssertEqual(cameraCreditHint(override: "  Leica M6  ", line: "ISO 200", exifRead: true),
                       .reason("Written by hand on the Camera piece: “Leica M6”. Clear it there to compose the credit here."))
        XCTAssertEqual(cameraCreditHint(override: "   ", line: "ISO 200 · ƒ/4", exifRead: true),
                       .line("“ISO 200 · ƒ/4”"))
        XCTAssertEqual(cameraCreditHint(override: nil, line: "", exifRead: true),
                       .reason("This picture records none of the facts ticked below — nothing to credit."))
        XCTAssertEqual(cameraCreditHint(override: nil, line: "", exifRead: false),
                       .reason("This picture records no camera, lens or exposure — nothing to credit. Write the line yourself on the Camera piece if you want one."))
    }

    func testListsTheChosenFactsInOrderThenTheRest() {
        XCTAssertEqual(cameraFieldRows([.iso, .body]).map(\.id),
                       [.iso, .body, .lens, .focal35, .focal, .aperture, .shutter, .ev, .altitude])
        XCTAssertEqual(cameraFieldRows([]).map(\.id), cameraFields.map(\.id))
    }

    func testTicksAppendAndUnticksRemove() {
        XCTAssertEqual(cameraFieldsToggled([.body], .iso, true), [.body, .iso])
        XCTAssertEqual(cameraFieldsToggled([.body, .iso], .iso, true), [.body, .iso])
        XCTAssertEqual(cameraFieldsToggled([.body, .iso], .body, false), [.iso])
    }

    func testMovesAChosenFactOnePlaceAndRefusesPastAnEnd() {
        XCTAssertEqual(cameraFieldsMoved([.body, .lens, .iso], .iso, -1), [.body, .iso, .lens])
        XCTAssertEqual(cameraFieldsMoved([.body, .lens, .iso], .body, 1), [.lens, .body, .iso])
        XCTAssertNil(cameraFieldsMoved([.body, .lens], .body, -1))
        XCTAssertNil(cameraFieldsMoved([.body, .lens], .lens, 1))
        XCTAssertNil(cameraFieldsMoved([.body], .iso, 1))
    }

    func testAFactReadsItsValueTheZeroEvOrThatItIsNotRecorded() {
        let facts = cameraFacts(plateSony)
        XCTAssertEqual(cameraFactValue(facts, .iso), "ISO 200")
        XCTAssertEqual(cameraFactValue(facts, .altitude), "not recorded by this picture")
        var flat = plateSony
        flat.exposureBias = 0
        XCTAssertEqual(cameraFactValue(cameraFacts(flat), .ev), "±0 — the camera’s own reading, not drawn in a line")
        flat.exposureBias = nil
        XCTAssertEqual(cameraFactValue(cameraFacts(flat), .ev), "not recorded by this picture")
    }

    func testTheBodysNameIsWrittenOnceOnTheTripAndMatchedWithoutCase() {
        XCTAssertEqual(cameraBodyAlias(nil, "ILCE-7CM2"), "")
        XCTAssertEqual(cameraBodyAlias([" ilce-7cm2 ": "A7C II"], "ILCE-7CM2"), "A7C II")
        XCTAssertEqual(cameraBodyAlias(["FC8482": "Mini 4 Pro"], "ILCE-7CM2"), "")
        let renamed = withCameraBodyAlias(["ilce-7cm2": "old", "FC8482": "Mini 4 Pro"], "ILCE-7CM2", "A7C II")
        XCTAssertEqual(renamed, ["ILCE-7CM2": "A7C II", "FC8482": "Mini 4 Pro"])
        XCTAssertEqual(withCameraBodyAlias(renamed, "ILCE-7CM2", "  "), ["FC8482": "Mini 4 Pro"])
        XCTAssertEqual(withCameraBodyAlias(nil, "FC8482", "Mini 4 Pro"), ["FC8482": "Mini 4 Pro"])
    }

    func testThePlaceSaysWhereTheLayoutGoesAndWhetherItMeetsTheBadge() {
        var spec = defaultPlateSpec()
        XCTAssertEqual(cameraPlaceHint(spec, badgeAnchor: .bottomLeft), "Hung under the badge, and moves with it.")
        spec.place = .cell(.bottomLeft)
        XCTAssertEqual(cameraPlaceHint(spec, badgeAnchor: .bottomLeft),
                       "The badge is anchored in this cell too — they will overlap.")
        XCTAssertEqual(cameraPlaceHint(spec, badgeAnchor: .topLeft), "In a cell of its own, where the badge is not.")
        spec.layout = .bar
        XCTAssertEqual(cameraPlaceHint(spec, badgeAnchor: .topLeft),
                       "An edge bar runs along the bottom — or the top, from a top cell.")
        spec.layout = .margin
        XCTAssertEqual(cameraPlaceHint(spec, badgeAnchor: .topLeft),
                       "A margin runs down the right — or the left, from a left cell.")
    }

    func testTheBarsShadeRunsAlongItsEdge() {
        var spec = defaultPlateSpec()
        spec.layout = .bar
        XCTAssertEqual(cameraBarEdge(spec), .bottom)
        spec.place = .cell(.topRight)
        XCTAssertEqual(cameraBarEdge(spec), .top)
        spec.place = .cell(.centerLeft)
        XCTAssertEqual(cameraBarEdge(spec), .bottom)
        spec.place = .cell(.topCenter)
        let shade = cameraBarShade(spec, id: "s1")
        XCTAssertEqual(shade, createShade(id: "s1", direction: .top, reach: 0.24, strength: 0.7, falloff: .inOut, core: 0.4))
    }

    func testTheSizeReadsAsAPercentage() {
        XCTAssertEqual(plateSizeLabel(1), "100%")
        XCTAssertEqual(plateSizeLabel(0.6), "60%")
        XCTAssertEqual(plateSizeLabel(1.15), "115%")
    }

    func testATileIsTheBadgesOwnElementsWithTheRealFactsOrNothing() throws {
        XCTAssertEqual(plateTileElements(cameraFacts(nil), legacyCameraFields, defaultCameraWords, .line), [])
        let facts = cameraFacts(plateSony)
        let line = plateTileElements(facts, legacyCameraFields, defaultCameraWords, .line)
        let only = try XCTUnwrap(line.first)
        XCTAssertEqual(line.count, 1)
        XCTAssertEqual(only.id, "tile:line")
        XCTAssertEqual(only.text, factsLine(facts, legacyCameraFields))
        XCTAssertLessThanOrEqual(only.sizeFrac, 0.1)
        for layout in PlateLayout.allCases {
            let els = plateTileElements(facts, [.body, .lens, .aperture, .shutter, .iso, .ev], defaultCameraWords, layout)
            XCTAssertFalse(els.isEmpty, layout.rawValue)
            XCTAssertTrue(els.allSatisfy { $0.id.hasPrefix("tile:\(layout.rawValue)") }, layout.rawValue)
            XCTAssertTrue(els.allSatisfy { $0.y >= 0 && $0.y <= 1 }, layout.rawValue)
        }
    }

    func testAnEdgeBarHangsFromTheFramesOwnEdgesAndStacksWhenItsEndsWouldMeet() {
        let facts = cameraFacts(plateSony)
        // The numbers alone sit at the far end of the edge.
        let numbers = plateTileElements(facts, [.aperture, .iso], defaultCameraWords, .bar)
        XCTAssertEqual(numbers.count, 1)
        assertClose(numbers[0].x, 0.95, 9)
        XCTAssertEqual(numbers[0].anchor, .topRight)
        // The body and the numbers do not fit one line of a tile: two lines, both from the start.
        let both = plateTileElements(facts, [.body, .aperture, .iso], defaultCameraWords, .bar)
        XCTAssertEqual(both.count, 2)
        XCTAssertEqual(both.map(\.x), [0.05, 0.05])
        XCTAssertLessThan(both[0].y, both[1].y)
    }
}
