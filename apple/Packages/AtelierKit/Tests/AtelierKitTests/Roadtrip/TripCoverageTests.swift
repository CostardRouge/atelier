// Port of `src/shared/roadtrip/trip-coverage.test.ts`, case for case.

import Foundation
import XCTest
@testable import AtelierKit

private final class Seq: @unchecked Sendable {
    var n = 0
    func next() -> Int { n += 1; return n }
}

private let seq = Seq()

private func post(_ date: IsoDate, end: IsoDate? = nil, published: Bool = false, kind: PostKind = .photo) -> TripPost {
    let n = seq.next()
    return TripPost(id: "p\(n)", kind: kind, date: date, endDate: end, title: "post \(n)", media: nil,
                    badge: defaultPostBadge(kind), slides: [], includeCta: false, projectId: nil, grade: nil,
                    publishedAt: published ? 1_700_000_000_000 : nil, createdAt: 1_600_000_000_000)
}

private func stage(_ name: String, _ startDate: IsoDate, _ endDate: IsoDate) -> TripStage {
    TripStage(id: "s-\(name)", name: name, region: "WA", startDate: startDate, endDate: endDate, places: [])
}

private func trip(startDate: IsoDate = "2025-03-01", endDate: IsoDate = "2025-03-10", stages: [TripStage] = [],
                  posts: [TripPost] = []) -> TripDoc {
    TripDoc(version: 1, id: "t1", name: "Australie", startDate: startDate, endDate: endDate, stages: stages,
            posts: posts, theme: nil, createdAt: 0, updatedAt: 0)
}

final class CoveragePostDaysTests: XCTestCase {
    func testIsTheSingleDateForAOneDayPost() {
        XCTAssertEqual(postDays(trip(), post("2025-03-04")), ["2025-03-04"])
    }

    func testCoversEveryDayOfAMultiDayPost() {
        XCTAssertEqual(postDays(trip(), post("2025-03-04", end: "2025-03-06")), ["2025-03-04", "2025-03-05", "2025-03-06"])
    }

    func testClampsASpanThatRunsPastTheTrip() {
        XCTAssertEqual(postDays(trip(), post("2025-03-09", end: "2025-03-20")), ["2025-03-09", "2025-03-10"])
    }

    func testDropsAPostDatedOutsideTheTripEntirely() {
        XCTAssertEqual(postDays(trip(), post("2025-02-20")), [])
    }

    func testIgnoresAnEndDateThatPrecedesTheStart() {
        XCTAssertEqual(postDays(trip(), post("2025-03-04", end: "2025-03-01")), ["2025-03-04"])
    }
}

final class CoveragePostDayRangeTests: XCTestCase {
    func testGivesABadgeItsNumbers() {
        XCTAssertEqual(postDayRange(trip(), post("2025-03-01")), PostDayRange(from: 1, to: 1, total: 10))
    }

    func testSpansAMultiDayPost() {
        XCTAssertEqual(postDayRange(trip(), post("2025-03-04", end: "2025-03-06")), PostDayRange(from: 4, to: 6, total: 10))
    }

    func testKeepsTheRealTotalOnALongTrip() {
        let long = trip(startDate: "2025-03-01", endDate: "2026-01-04")
        XCTAssertEqual(postDayRange(long, post("2025-03-27")), PostDayRange(from: 27, to: 27, total: 310))
    }

    func testRefusesATripWhoseSpanIsReversed() {
        let broken = trip(startDate: "2025-03-10", endDate: "2025-03-01")
        XCTAssertNil(postDayRange(broken, post("2025-03-04")))
    }
}

final class CoveragePostsByDayTests: XCTestCase {
    func testFilesAMultiDayPostUnderEachOfItsDays() {
        let doc = trip(posts: [post("2025-03-02", end: "2025-03-04")])
        XCTAssertEqual(postsByDay(doc).keys.sorted(), ["2025-03-02", "2025-03-03", "2025-03-04"])
    }

    func testKeepsSeveralPostsOnTheSameDay() {
        let doc = trip(posts: [post("2025-03-02"), post("2025-03-02")])
        XCTAssertEqual(postsByDay(doc)["2025-03-02"]?.count, 2)
    }
}

final class CoverageTripCoverageTests: XCTestCase {
    func testListsEveryDayOfTheTripToldOrNot() {
        let c = tripCoverage(trip())
        XCTAssertEqual(c.totalDays, 10)
        XCTAssertEqual(c.days.count, 10)
        XCTAssertEqual(c.days[0].date, "2025-03-01")
        XCTAssertEqual(c.days[0].dayNumber, 1)
        XCTAssertEqual(c.days[9].date, "2025-03-10")
        XCTAssertEqual(c.days[9].dayNumber, 10)
    }

    func testCountsToldDaysPublishedDaysAndPostsApart() {
        let doc = trip(posts: [post("2025-03-02", published: true), post("2025-03-02"), post("2025-03-05")])
        let c = tripCoverage(doc)
        XCTAssertEqual(c.posts, 3)
        XCTAssertEqual(c.publishedPosts, 1)
        XCTAssertEqual(c.toldDays, 2)
        XCTAssertEqual(c.publishedDays, 1)
    }

    func testReportsTheWholeTripAsOneGapWhenNothingIsTold() {
        let c = tripCoverage(trip())
        XCTAssertEqual(c.gaps, [Gap(start: "2025-03-01", end: "2025-03-10", length: 10)])
        XCTAssertEqual(c.longestGap?.length, 10)
    }

    func testSplitsTheSilencesAroundTheDaysThatAreTold() {
        let doc = trip(posts: [post("2025-03-03"), post("2025-03-08")])
        let c = tripCoverage(doc)
        XCTAssertEqual(c.gaps, [
            Gap(start: "2025-03-01", end: "2025-03-02", length: 2),
            Gap(start: "2025-03-04", end: "2025-03-07", length: 4),
            Gap(start: "2025-03-09", end: "2025-03-10", length: 2),
        ])
        XCTAssertEqual(c.longestGap, Gap(start: "2025-03-04", end: "2025-03-07", length: 4))
    }

    func testHasNoGapLeftWhenEveryDayIsTold() {
        let doc = trip(posts: [post("2025-03-01", end: "2025-03-10")])
        let c = tripCoverage(doc)
        XCTAssertEqual(c.gaps, [])
        XCTAssertNil(c.longestGap)
        XCTAssertEqual(c.toldDays, 10)
    }

    func testCountsADraftAsTellingTheDayButNotAsPublished() {
        let doc = trip(posts: [post("2025-03-04")])
        let c = tripCoverage(doc)
        XCTAssertEqual(c.days[3].posts.count, 1)
        XCTAssertEqual(c.days[3].published, 0)
        XCTAssertEqual(c.publishedDays, 0)
    }
}

final class CoverageStageAtTests: XCTestCase {
    private let doc = trip(startDate: "2025-03-01", endDate: "2025-03-20",
                           stages: [stage("Perth", "2025-03-01", "2025-03-05"), stage("Kalbarri", "2025-03-05", "2025-03-08")])

    func testFindsTheStageCoveringADate() {
        XCTAssertEqual(stageAt(doc, "2025-03-03")?.name, "Perth")
        XCTAssertEqual(stageAt(doc, "2025-03-07")?.name, "Kalbarri")
    }

    func testGivesAnOverlappingTravelDayToWhereYouEndedUp() {
        XCTAssertEqual(stageAt(doc, "2025-03-05")?.name, "Kalbarri")
    }

    func testIsNilOutsideEveryStage() {
        XCTAssertNil(stageAt(doc, "2025-03-15"))
    }
}

final class CoverageStageDayNumberTests: XCTestCase {
    private let kalbarri = stage("Kalbarri", "2025-03-05", "2025-03-07")

    func testCountsTheDaysAtAPlace() {
        XCTAssertEqual(stageDayNumber(kalbarri, "2025-03-06"), StageDay(day: 2, total: 3))
        XCTAssertEqual(stageDayNumber(kalbarri, "2025-03-05"), StageDay(day: 1, total: 3))
    }

    func testRefusesADateTheTripWasNotThere() {
        XCTAssertNil(stageDayNumber(kalbarri, "2025-03-09"))
    }
}
