// Port of `src/shared/roadtrip/time-ago.test.ts`.

import Foundation
import XCTest
@testable import AtelierKit

private let W = defaultTimeAgoWords

private func line(_ from: IsoDate, _ to: IsoDate, _ mode: TimeAgoMode, _ words: TimeAgoWords = W) -> String? {
    timeAgoLine(from, to, mode, words)
}

final class TripTimeGapTests: XCTestCase {
    func testMeasuresEveryUnitOfOneGap() {
        let gap = timeGap("2025-03-27", "2026-08-24")!
        XCTAssertEqual(gap.days, 515)
        XCTAssertEqual(gap.weeks, 73)
        XCTAssertEqual(gap.months, 16)
        XCTAssertEqual(gap.years, 1)
    }

    func testCallsADateAnAnniversaryOnlyOnTheSameMonthAndDay() {
        XCTAssertTrue(timeGap("2025-03-27", "2026-03-27")!.isAnniversary)
        XCTAssertFalse(timeGap("2025-03-27", "2026-03-28")!.isAnniversary)
        XCTAssertTrue(timeGap("2025-03-27", "2027-03-27")!.isAnniversary)
    }

    func testIsNotAnAnniversaryUnderAYearEvenOnTheSameDayOfTheMonth() {
        XCTAssertFalse(timeGap("2025-03-27", "2025-09-27")!.isAnniversary)
    }

    func testIsNilOnAnUnreadableDate() {
        XCTAssertNil(timeGap("nope", "2026-03-27"))
    }
}

final class TripAutoModeTests: XCTestCase {
    private func gapOf(_ from: IsoDate, _ to: IsoDate) -> TimeGap { timeGap(from, to)! }

    func testPrefersTheAnniversaryOnTheDayItReallyIsOne() {
        XCTAssertEqual(autoMode(gapOf("2025-03-27", "2026-03-27")), .anniversary)
    }

    func testFallsToYearsPlusMonthsTheRestOfTheYear() {
        XCTAssertEqual(autoMode(gapOf("2025-03-27", "2026-08-24")), .yearsMonths)
    }

    func testUsesMonthsThenWeeksThenDaysAsTheGapShortens() {
        XCTAssertEqual(autoMode(gapOf("2025-03-27", "2025-09-01")), .monthsAgo)
        XCTAssertEqual(autoMode(gapOf("2025-03-27", "2025-04-20")), .weeksAgo)
        XCTAssertEqual(autoMode(gapOf("2025-03-27", "2025-04-02")), .daysAgo)
    }
}

final class TripTimeAgoAnniversaryTests: XCTestCase {
    func testSpeaksOnTheRealAnniversary() {
        XCTAssertEqual(line("2025-03-27", "2026-03-27", .anniversary), "1 year ago today")
        XCTAssertEqual(line("2025-03-27", "2028-03-27", .anniversary), "3 years ago today")
    }

    func testSaysNothingOneDayEitherSideTheOldBug() {
        // The retired boolean fired on any date a year or more later, announcing
        // an anniversary on days that were not one.
        XCTAssertNil(line("2025-03-27", "2026-03-26", .anniversary))
        XCTAssertNil(line("2025-03-27", "2026-03-28", .anniversary))
        XCTAssertNil(line("2025-03-27", "2026-08-24", .anniversary))
    }

    func testSaysNothingBeforeTheFirstAnniversary() {
        XCTAssertNil(line("2025-03-27", "2025-09-27", .anniversary))
    }
}

final class TripTimeAgoCountingTests: XCTestCase {
    func testCountsDays() {
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .daysAgo), "515 days ago")
    }

    func testCountsWeeks() {
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .weeksAgo), "73 weeks ago")
    }

    func testCountsMonths() {
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .monthsAgo), "16 months ago")
    }

    func testCountsYearsAndTheMonthsPastThem() {
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .yearsMonths), "1 year 4 months ago")
    }

    func testDropsTheMonthsWhenAWholeNumberOfYearsHasPassed() {
        XCTAssertEqual(line("2025-03-27", "2027-03-27", .yearsMonths), "2 years ago")
    }

    func testFallsBackToMonthsWhenAYearHasNotPassed() {
        XCTAssertEqual(line("2025-03-27", "2025-09-01", .yearsMonths), "5 months ago")
    }

    func testPicksTheNounByTheNumberNeverByARule() {
        XCTAssertEqual(line("2025-03-27", "2025-03-28", .daysAgo), "1 day ago")
        XCTAssertEqual(line("2025-03-27", "2025-04-03", .weeksAgo), "1 week ago")
    }

    func testStatesADateWithoutArithmeticForSince() {
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .since), "since 27 Mar 2025")
    }
}

final class TripTimeAgoAutoTests: XCTestCase {
    func testLandsOnTheAnniversaryLineOnTheDay() {
        XCTAssertEqual(line("2025-03-27", "2026-03-27", .auto), "1 year ago today")
    }

    func testLandsOnSomethingTrueEveryOtherDay() {
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .auto), "1 year 4 months ago")
        XCTAssertEqual(line("2025-03-27", "2025-04-02", .auto), "6 days ago")
    }

    func testNeverReturnsNilForARealPastGap() {
        // Auto is the mode a user leaves on and forgets; it must always have
        // something true to say.
        for to in ["2025-03-28", "2025-04-10", "2025-06-01", "2026-03-27", "2026-08-24", "2030-01-01"] {
            XCTAssertNotNil(line("2025-03-27", to, .auto), to)
        }
    }
}

final class TripTimeAgoSilenceTests: XCTestCase {
    func testIsSilentWhenTheReferenceIsThePicturesOwnDay() {
        XCTAssertNil(line("2025-03-27", "2025-03-27", .auto))
        XCTAssertNil(line("2025-03-27", "2025-03-27", .daysAgo))
    }

    func testIsSilentAboutTheFuture() {
        XCTAssertNil(line("2025-03-27", "2025-03-01", .auto))
    }

    func testIsSilentWhenSwitchedOff() {
        XCTAssertNil(line("2025-03-27", "2026-08-24", .off))
    }

    func testStillStatesTheDateForSinceWhichNeedsNoElapsedTime() {
        XCTAssertEqual(line("2025-03-27", "2025-03-27", .since), "since 27 Mar 2025")
    }

    func testIsSilentOnAnUnreadableDate() {
        XCTAssertNil(line("nope", "2026-08-24", .auto))
    }
}

final class TripTimeAgoWordsTests: XCTestCase {
    func testReadsInFrenchWhenHandedTheFrenchVocabulary() {
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .daysAgo, frenchTimeAgoWords), "il y a 515 jours")
        XCTAssertEqual(line("2025-03-27", "2026-03-27", .anniversary, frenchTimeAgoWords), "il y a 1 an, jour pour jour")
    }

    func testHandlesALanguageWhosePluralIsTheSameWord() {
        // "mois" is both — the noun table decides, no rule invents an s.
        XCTAssertEqual(line("2025-03-27", "2025-04-30", .monthsAgo, frenchTimeAgoWords), "il y a 1 mois")
    }

    func testTakesAnEntirelyInventedTemplate() {
        var words = W
        words.agoTemplate = "↺ {n}"
        XCTAssertEqual(line("2025-03-27", "2026-08-24", .daysAgo, words), "↺ 515 days")
    }

    func testEditsAWordThroughItsKey() {
        var words = W
        words[.days] = "jours"
        XCTAssertEqual(words.days, "jours")
        XCTAssertEqual(timeAgoWordFields.map(\.key.rawValue).first, "agoTemplate")
        XCTAssertTrue(TimeAgoWordKey.allCases.allSatisfy { W[$0] == defaultTimeAgoWords[$0] })
    }
}

final class TripTimeAgoPreviewsTests: XCTestCase {
    private func byId(_ date: IsoDate) -> [TimeAgoMode: String?] {
        Dictionary(uniqueKeysWithValues: timeAgoPreviews(date, "2026-08-24", W).map { ($0.id, $0.text) })
    }

    func testGivesTheRealLineForThisPictureNotAnExample() {
        let lines = byId("2025-03-27")
        XCTAssertEqual(lines[.daysAgo], "515 days ago")
        XCTAssertEqual(lines[.since], "since 27 Mar 2025")
        XCTAssertEqual(lines[.off], .some(nil))
    }

    func testIsNilForAModeWithNothingTrueToSay() {
        // Not the anniversary on 24 August.
        XCTAssertEqual(byId("2025-03-27")[.anniversary], .some(nil))
    }

    func testMovesWithThePicturesDayNothingHereIsFixed() {
        let a = timeAgoPreviews("2025-03-27", "2026-08-24", W)
        let b = timeAgoPreviews("2025-11-17", "2026-08-24", W)
        XCTAssertNotEqual(a.first { $0.id == .daysAgo }!.text, b.first { $0.id == .daysAgo }!.text)
    }

    func testCoversEveryModeThePanelOffers() {
        XCTAssertEqual(timeAgoPreviews("2025-03-27", "2026-08-24", W).count, timeAgoModes.count)
    }
}
