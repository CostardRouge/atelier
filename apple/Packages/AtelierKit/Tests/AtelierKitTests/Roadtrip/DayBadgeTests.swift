// Port of `src/shared/roadtrip/day-badge.test.ts` — every case: what a badge
// says in each counter mode, the words as data, overrides, the camera credit,
// the WHEN line, the place marker, a mode that cannot count saying why, the
// previews, and a stage named through its places. The words' own specs are
// `DayBadgeWordsTests.swift`; the credit read from facts is `BadgePlateTests`.

import XCTest
@testable import AtelierKit

private func post(_ date: IsoDate, _ end: IsoDate? = nil) -> TripPost {
    TripPost(id: "p1", kind: .photo, date: date, endDate: end, title: "", media: nil,
             badge: defaultPostBadge(.photo), createdAt: 0)
}

private func stage(_ name: String, _ start: IsoDate, _ end: IsoDate, _ region: String = "Western Australia") -> TripStage {
    TripStage(id: "s-\(name)", name: name, region: region, startDate: start, endDate: end, places: [])
}

private func trip(_ change: (inout TripDoc) -> Void = { _ in }) -> TripDoc {
    var doc = TripDoc(version: 3, id: "t1", name: "Australia", startDate: "2025-03-01", endDate: "2026-01-04",
                      theme: nil, cta: defaultCta, grade: emptyGrade(), sourceId: "local", createdAt: 0, updatedAt: 0)
    change(&doc)
    return doc
}

private func opts(_ change: (inout BadgeOptions) -> Void = { _ in }) -> BadgeOptions {
    var o = BadgeOptions(mode: .day, words: defaultBadgeWords, timeAgo: .off, today: "2026-08-23")
    change(&o)
    return o
}

private let kalbarri = trip { $0.stages = [stage("Kalbarri", "2025-03-25", "2025-03-28")] }

final class DayBadgeDayTests: XCTestCase {
    func testIsTheFoundingCaseInEnglishByDefault() {
        XCTAssertEqual(badgeContent(trip(), post("2025-03-27"), opts()),
                       BadgeContent(kicker: "Australia", label: "Day", headline: "27", counter: "of 310",
                                    caption: nil, timing: nil, exif: nil))
    }

    func testKeepsTheHeadlineABareNumeralNeverAPhrase() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts()))
        XCTAssertEqual(c.headline, "27")
        XCTAssertNil(c.headline.range(of: "[A-Za-z]", options: .regularExpression))
    }

    func testCaptionsWithThePlaceWhenAStageCoversTheDay() {
        XCTAssertEqual(badgeContent(kalbarri, post("2025-03-27"), opts())?.caption, "Kalbarri")
    }

    func testRefusesATripWhoseSpanIsReversedRatherThanGuessingATotal() {
        let broken = trip {
            $0.startDate = "2026-01-04"
            $0.endDate = "2025-03-01"
        }
        XCTAssertNil(badgeContent(broken, post("2025-03-27"), opts()))
    }

    func testDropsTheKickerWhenTheTripHasNoName() throws {
        XCTAssertNil(try XCTUnwrap(badgeContent(trip { $0.name = "  " }, post("2025-03-27"), opts())).kicker)
    }
}

final class DayBadgeWordsAreDataTests: XCTestCase {
    func testSaysWhateverVocabularyItIsHanded() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts { $0.words = frenchBadgeWords }))
        XCTAssertEqual(c.label, "Jour")
        XCTAssertEqual(c.headline, "27")
        XCTAssertEqual(c.counter, "sur 310")
    }

    func testTakesAnEntirelyInventedVocabulary() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts {
            $0.words.day = "Sol"
            $0.words.of = "·"
        }))
        XCTAssertEqual(c.label, "Sol")
        XCTAssertEqual(c.counter, "· 310")
    }

    func testTakesAnInventedTemporalTemplateToo() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts {
            $0.timeAgo = .daysAgo
            $0.today = "2026-08-24"
            $0.words.time.agoTemplate = "↺ {n}"
        }))
        XCTAssertEqual(c.timing, "↺ 515 days")
    }
}

final class DayBadgeOverridesTests: XCTestCase {
    func testReplacesAComputedPieceWithTheAuthorsOwnWords() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts {
            $0.overrides = [.kicker: "THE RED CENTRE", .caption: "Uluru"]
        }))
        XCTAssertEqual(c.kicker, "THE RED CENTRE")
        XCTAssertEqual(c.caption, "Uluru")
    }

    func testCanOverrideTheNumeralItself() {
        XCTAssertEqual(badgeContent(trip(), post("2025-03-27"), opts { $0.overrides = [.headline: "∞"] })?.headline, "∞")
    }

    func testTreatsAnEmptyOrBlankOverrideAsComputedNeverAsBlank() throws {
        // Clearing the field has to give the derived value back.
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts { $0.overrides = [.kicker: "", .label: "   "] }))
        XCTAssertEqual(c.kicker, "Australia")
        XCTAssertEqual(c.label, "Day")
    }

    func testLeavesThePiecesItWasNotGivenAlone() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts { $0.overrides = [.kicker: "ELSEWHERE"] }))
        XCTAssertEqual(c.label, "Day")
        XCTAssertEqual(c.headline, "27")
        XCTAssertEqual(c.counter, "of 310")
    }

    func testOverridesAStageModesPiecesToo() throws {
        let c = try XCTUnwrap(badgeContent(kalbarri, post("2025-03-27"), opts {
            $0.mode = .stageDay
            $0.overrides = [.label: "KALBARRI NP"]
        }))
        XCTAssertEqual(c.label, "KALBARRI NP")
        XCTAssertEqual(c.headline, "3")
        XCTAssertEqual(c.counter, "of 4")
    }
}

final class DayBadgeRangeTests: XCTestCase {
    func testSetsARealRangeWithAnEnDash() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27", "2025-03-29"), opts { $0.mode = .dayRange }))
        XCTAssertEqual(c.label, "Days")
        XCTAssertEqual(c.headline, "27–29")
        XCTAssertEqual(c.counter, "of 310")
    }

    func testFallsBackToOneDayWhenThePostCoversOnlyOne() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts { $0.mode = .dayRange }))
        XCTAssertEqual(c.label, "Day")
        XCTAssertEqual(c.headline, "27")
    }
}

final class DayBadgeStageModesTests: XCTestCase {
    func testCountsTheDayInsideTheStage() {
        XCTAssertEqual(badgeContent(kalbarri, post("2025-03-27"), opts { $0.mode = .stageDay }),
                       BadgeContent(kicker: "Australia", label: "Kalbarri", headline: "3", counter: "of 4",
                                    caption: "Western Australia", timing: nil, exif: nil))
    }

    func testCountsHowLongTheTripStayed() throws {
        let c = try XCTUnwrap(badgeContent(kalbarri, post("2025-03-27"), opts { $0.mode = .stageLength }))
        XCTAssertEqual(c.headline, "4")
        XCTAssertEqual(c.counter, "days in Kalbarri")
    }

    func testSaysDayInTheSingularForAOneDayStop() throws {
        let one = trip { $0.stages = [stage("Denham", "2025-03-27", "2025-03-27")] }
        let c = try XCTUnwrap(badgeContent(one, post("2025-03-27"), opts { $0.mode = .stageLength }))
        XCTAssertEqual(c.headline, "1")
        XCTAssertEqual(c.counter, "day in Denham")
    }

    func testFallsBackToTheDayOfTheTripOutsideEveryStageNeverInventingAPlace() throws {
        let c = try XCTUnwrap(badgeContent(kalbarri, post("2025-06-01"), opts { $0.mode = .stageDay }))
        XCTAssertEqual(c.label, "Day")
        XCTAssertEqual(c.headline, "93")
        XCTAssertEqual(c.counter, "of 310")
        XCTAssertNil(c.caption)
    }
}

final class DayBadgeCameraCreditTests: XCTestCase {
    private let line = "DJI Mini 4 Pro · 24 mm · ƒ/1.7 · 1/240 · ISO 100"

    func testDrawsTheMeasuredLineWhenThePieceAsksForIt() {
        let c = badgeContent(trip(), post("2025-03-27"), opts {
            $0.showExif = true
            $0.exposure = line
        })
        XCTAssertEqual(c?.exif, line)
    }

    func testIsAbsentUntilItIsAskedForNoStoredPieceGainsALine() throws {
        XCTAssertNil(try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts { $0.exposure = line })).exif)
    }

    func testIsAbsentOverAPictureThatRecordsNothingRatherThanBlank() throws {
        for exposure: String? in [nil, "   "] {
            let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts {
                $0.showExif = true
                $0.exposure = exposure
            }))
            XCTAssertNil(c.exif)
        }
    }

    func testNeverDisplacesThePlaceOrTheWhenLine() throws {
        let c = try XCTUnwrap(badgeContent(kalbarri, post("2025-03-27"), opts {
            $0.mode = .stageDay
            $0.timeAgo = .daysAgo
            $0.today = "2026-08-24"
            $0.showExif = true
            $0.exposure = line
        }))
        XCTAssertEqual(c.caption, "Western Australia")
        XCTAssertEqual(c.timing, "515 days ago")
        XCTAssertEqual(c.exif, line)
    }

    func testTakesAnOverrideSoAPictureWithNoExifCanStillBeCredited() {
        XCTAssertEqual(badgeContent(trip(), post("2025-03-27"), opts { $0.overrides = [.exif: "Shot on film"] })?.exif,
                       "Shot on film")
    }
}

final class DayBadgeWhenLineTests: XCTestCase {
    func testIsAPieceOfItsOwnTheTripsNameIsNeverDisplaced() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts {
            $0.timeAgo = .daysAgo
            $0.today = "2026-08-24"
        }))
        XCTAssertEqual(c.kicker, "Australia")
        XCTAssertEqual(c.timing, "515 days ago")
    }

    func testSpeaksOnTheRealAnniversary() {
        XCTAssertEqual(badgeContent(trip(), post("2025-03-27"), opts {
            $0.timeAgo = .anniversary
            $0.today = "2026-03-27"
        })?.timing, "1 year ago today")
    }

    func testIsSimplyAbsentWhenTheAnniversaryIsNotToday() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts {
            $0.timeAgo = .anniversary
            $0.today = "2026-08-24"
        }))
        XCTAssertNil(c.timing)
        XCTAssertEqual(c.kicker, "Australia")
    }

    func testIsAbsentWhenSwitchedOff() throws {
        XCTAssertNil(try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts())).timing)
    }

    func testReadsTheReferenceDayNotTheRealToday() {
        XCTAssertEqual(badgeContent(trip(), post("2025-03-27"), opts {
            $0.timeAgo = .anniversary
            $0.referenceDate = "2026-03-27"
            $0.today = "2026-08-24"
        })?.timing, "1 year ago today")
    }

    func testCountsFromThePostsDayWhichIsThePicturesDay() {
        let setting: (inout BadgeOptions) -> Void = {
            $0.timeAgo = .daysAgo
            $0.today = "2026-08-24"
        }
        let a = badgeContent(trip(), post("2025-03-27"), opts(setting))
        let b = badgeContent(trip(), post("2025-11-17"), opts(setting))
        XCTAssertNotEqual(a?.timing, b?.timing)
    }

    func testLeavesTheHeadlineUntouchedTheDayIsStillWhatDominates() throws {
        let c = try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts {
            $0.timeAgo = .auto
            $0.today = "2026-08-24"
        }))
        XCTAssertEqual(c.headline, "27")
        XCTAssertEqual(c.counter, "of 310")
    }

    func testYieldsToAnExplicitOverrideLikeEveryOtherPiece() {
        XCTAssertEqual(badgeContent(trip(), post("2025-03-27"), opts {
            $0.timeAgo = .daysAgo
            $0.today = "2026-08-24"
            $0.overrides = [.timing: "A YEAR AND A HALF AGO"]
        })?.timing, "A YEAR AND A HALF AGO")
    }
}

final class DayBadgePlaceMarkerTests: XCTestCase {
    func testIsAbsentUnlessAskedFor() {
        XCTAssertEqual(badgeContent(kalbarri, post("2025-03-27"), opts())?.caption, "Kalbarri")
    }

    func testSetsTheMarkerBeforeThePlace() {
        XCTAssertEqual(badgeContent(kalbarri, post("2025-03-27"), opts { $0.showPin = true })?.caption, "\u{25C6} Kalbarri")
    }

    func testTakesWhateverGlyphTheTripWrites() {
        let c = badgeContent(kalbarri, post("2025-03-27"), opts {
            $0.showPin = true
            $0.words.pin = "\u{1F4CD}"
        })
        XCTAssertEqual(c?.caption, "\u{1F4CD} Kalbarri")
    }

    func testMarksThePlaceInAStageModeTooWhereverItLands() {
        let c = badgeContent(kalbarri, post("2025-03-27"), opts {
            $0.mode = .stageDay
            $0.showPin = true
        })
        XCTAssertEqual(c?.label, "\u{25C6} Kalbarri")
    }

    func testAddsNothingWhenThereIsNoPlaceToMark() throws {
        XCTAssertNil(try XCTUnwrap(badgeContent(trip(), post("2025-03-27"), opts { $0.showPin = true })).caption)
    }

    func testAddsNothingWhenTheGlyphHasBeenCleared() {
        let c = badgeContent(kalbarri, post("2025-03-27"), opts {
            $0.showPin = true
            $0.words.pin = "  "
        })
        XCTAssertEqual(c?.caption, "Kalbarri")
    }
}

final class DayBadgeCounterPiecesTests: XCTestCase {
    func testIsSilentWhenTheModeWorked() throws {
        let p = try XCTUnwrap(counterPieces(kalbarri, post("2025-03-27"), .stageDay, defaultBadgeWords))
        XCTAssertNil(p.unavailable)
        XCTAssertEqual(p.headline, "3")
    }

    func testNamesTheDayNoStageCoversRatherThanFallingBackInSilence() throws {
        let p = try XCTUnwrap(counterPieces(kalbarri, post("2025-06-01"), .stageDay, defaultBadgeWords))
        XCTAssertTrue(p.unavailable?.contains("No stage covers") == true)
        XCTAssertTrue(p.unavailable?.contains("2025") == true)
        // And it still counts the day of the trip, which is always true.
        XCTAssertEqual(p.headline, "93")
    }

    func testSaysASingleDayPieceCannotBeARange() throws {
        let p = try XCTUnwrap(counterPieces(kalbarri, post("2025-03-27"), .dayRange, defaultBadgeWords))
        XCTAssertNotNil(p.unavailable?.range(of: "end date", options: .caseInsensitive))
    }

    func testIsSilentForARangeThatReallyIsOne() throws {
        let p = try XCTUnwrap(counterPieces(kalbarri, post("2025-03-27", "2025-03-29"), .dayRange, defaultBadgeWords))
        XCTAssertNil(p.unavailable)
        XCTAssertEqual(p.headline, "27–29")
    }

    func testPutsTheMarkerOnThePlaceItActuallyDraws() {
        let withPin = counterPieces(kalbarri, post("2025-03-27"), .day, defaultBadgeWords, true)
        XCTAssertEqual(withPin?.caption, "\(defaultBadgeWords.pin) Kalbarri")
    }
}

final class DayBadgeCounterPreviewsTests: XCTestCase {
    func testGivesTheRealLineForEveryModeThatHasOne() {
        let previews = counterPreviews(kalbarri, post("2025-03-27"), defaultBadgeWords)
        let byId = Dictionary(uniqueKeysWithValues: previews.map { ($0.id, $0) })
        XCTAssertEqual(byId[.day]?.text, "Day · 27 · of 310")
        XCTAssertEqual(byId[.stageDay]?.text, "Kalbarri · 3 · of 4")
        XCTAssertEqual(byId[.stageLength]?.text, "4 · days in Kalbarri")
    }

    func testShowsAReasonInsteadOfAFabricatedExample() throws {
        let previews = counterPreviews(trip(), post("2025-03-27"), defaultBadgeWords)
        for p in previews {
            if p.text == nil { XCTAssertFalse((p.reason ?? "").isEmpty) } else { XCTAssertNil(p.reason) }
        }
        let stageDay = try XCTUnwrap(previews.first { $0.id == .stageDay })
        XCTAssertNil(stageDay.text)
        XCTAssertTrue(stageDay.reason?.contains("No stage covers") == true)
    }

    func testNeverInventsAPlaceATripWithNoStagesDoesNotHave() {
        let previews = counterPreviews(trip(), post("2025-03-27"), defaultBadgeWords)
        XCTAssertFalse(previews.map { $0.text ?? "null" }.joined(separator: " ").contains("Kalbarri"))
    }

    func testFollowsTheTripsOwnWords() {
        var words = defaultBadgeWords
        words.day = "Jour"
        words.of = "sur"
        let previews = counterPreviews(trip(), post("2025-03-27"), words)
        XCTAssertEqual(previews.first { $0.id == .day }?.text, "Jour · 27 · sur 310")
    }
}

final class DayBadgeStagePlacesTests: XCTestCase {
    private func legStage(_ places: [(name: String, region: String)]) -> TripStage {
        TripStage(id: "s-leg", name: "", region: "", startDate: "2025-03-25", endDate: "2025-03-28",
                  places: places.enumerated().map { i, p in
                      TripPlace(id: "pl-\(i)", name: p.name, region: p.region, coords: nil)
                  })
    }

    func testDrawsTheLegAStageWithNoNameOfItsOwnDescribes() {
        let doc = trip { $0.stages = [legStage([("Perth", ""), ("Cairns", "")])] }
        let pieces = counterPieces(doc, post("2025-03-26"), .stageDay, defaultBadgeWords, false)
        XCTAssertEqual(pieces?.label, "Perth → Cairns")
        XCTAssertNil(pieces?.unavailable ?? nil)
    }

    func testCarriesTheRegionItsPlacesAgreeOnIntoTheCaption() {
        let doc = trip { $0.stages = [legStage([("Perth", "Western Australia"), ("Kalbarri", "Western Australia")])] }
        let pieces = counterPieces(doc, post("2025-03-26"), .stageDay, defaultBadgeWords, false)
        XCTAssertEqual(pieces?.caption, "Western Australia")
    }

    func testStillRefusesToInventAPlaceWhenTheStageNamesNone() {
        let doc = trip { $0.stages = [legStage([])] }
        let pieces = counterPieces(doc, post("2025-03-26"), .stageDay, defaultBadgeWords, false)
        XCTAssertTrue(pieces?.unavailable?.contains("names no place") == true)
        // Fallen back to the day of the trip, exactly as before.
        XCTAssertEqual(pieces?.label, defaultBadgeWords.day)
    }

    func testAStagesOwnNameStillWinsOverWhatItsPlacesDescribe() {
        var both = legStage([("Perth", ""), ("Cairns", "")])
        both.name = "The Long Drive"
        let doc = trip { $0.stages = [both] }
        XCTAssertEqual(counterPieces(doc, post("2025-03-26"), .stageDay, defaultBadgeWords, false)?.label, "The Long Drive")
    }
}
